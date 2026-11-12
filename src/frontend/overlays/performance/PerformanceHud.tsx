/**
 * The performance HUD surface.
 *
 * It draws the snapshot the runtime publishes and owns the dock gesture, the snap
 * edges, and the hand-off to the torn-off window.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import {
  announcePerformanceHudDock,
  closeTornOffPerformanceHud,
  inspectTornOffPerformanceHud,
  listenForPerformanceHudDock,
  listenForPerformanceHudFrames,
  listenForPerformanceHudSnapEdges,
  listenForTornOffPerformanceHudClose,
  listenForTornOffPerformanceHudMove,
  publishPerformanceHudSnapEdges,
  startTornOffPerformanceHudDrag,
} from "../../../core/platform/desktop/performanceHudWindow.ts";
import {
  getPerformanceHudBlocks,
  getPerformanceHudSnapshot,
  getPerformanceHudSnapEdges,
  isPerformanceHudDetached,
  isPerformanceHudVisible,
  performanceHudPosition,
  setPerformanceHudDetached,
  setPerformanceHudSnapshot,
  setPerformanceHudPosition,
  subscribePerformanceHudDetached,
  subscribePerformanceHudSnapshot,
  subscribePerformanceHudSnapEdges,
  subscribePerformanceHudVisibility,
  setPerformanceHudSnapEdges,
  type PerformanceHudPosition,
  type PerformanceHudSnapshot,
} from "./performanceHud.ts";

/** Keeps the HUD fully inside the given viewport bounds. */
function clampPosition(
  position: PerformanceHudPosition,
  width: number,
  height: number,
  panel: HTMLElement | null,
): PerformanceHudPosition {
  const panelWidth = panel?.offsetWidth ?? 260;
  const panelHeight = panel?.offsetHeight ?? 220;
  return {
    x: Math.min(Math.max(0, position.x), Math.max(0, width - panelWidth)),
    y: Math.min(Math.max(0, position.y), Math.max(0, height - panelHeight)),
  };
}

/** Converts one rolling traffic series into SVG polyline coordinates. */
function trafficPoints(samples: readonly number[], maximum: number): string {
  const values = samples.length > 0 ? samples : [0];
  const width = 240;
  const height = 72;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
      const y = height - (Math.max(0, value) / maximum) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Formats a traffic rate using the same binary units as the byte counters. */
function formatTrafficRate(kilobytesPerSecond: number): string {
  if (kilobytesPerSecond >= 1024) {
    return `${(kilobytesPerSecond / 1024).toFixed(1)} MiB/s`;
  }
  return `${kilobytesPerSecond.toFixed(1)} KiB/s`;
}

/** Draws the upload/download traffic history while a collaboration room is active. */
function CollaborationTrafficGraph({ snapshot }: { snapshot: PerformanceHudSnapshot }) {
  const { t } = useTranslation();
  const maximum = Math.max(
    1,
    ...snapshot.collaborationUploadSamples,
    ...snapshot.collaborationDownloadSamples,
  );
  return (
    <section
      className="redux-performance-hud-traffic"
      data-testid="performance-hud-collaboration-traffic"
      aria-label={t("chrome.performanceHud.collaborationTraffic")}
    >
      <div className="redux-performance-hud-traffic-heading">
        <span className="redux-performance-hud-label">
          {t("chrome.performanceHud.collaborationTraffic")}
        </span>
      </div>
      <svg
        className="redux-performance-hud-traffic-chart"
        viewBox="0 0 240 72"
        role="img"
        aria-label={t("chrome.performanceHud.trafficGraph")}
        preserveAspectRatio="none"
      >
        <line className="redux-performance-hud-traffic-grid" x1="0" y1="71" x2="240" y2="71" />
        <polyline
          className="redux-performance-hud-traffic-line is-upload"
          points={trafficPoints(snapshot.collaborationUploadSamples, maximum)}
        />
        <polyline
          className="redux-performance-hud-traffic-line is-download"
          points={trafficPoints(snapshot.collaborationDownloadSamples, maximum)}
        />
      </svg>
      <div className="redux-performance-hud-traffic-legend">
        <span className="redux-performance-hud-traffic-key is-upload">
          <i aria-hidden="true" />
          <span>{t("chrome.performanceHud.upload")}</span>
          <strong>{formatTrafficRate(snapshot.collaborationUploadKbps)}</strong>
        </span>
        <span className="redux-performance-hud-traffic-key is-download">
          <i aria-hidden="true" />
          <span>{t("chrome.performanceHud.download")}</span>
          <strong>{formatTrafficRate(snapshot.collaborationDownloadKbps)}</strong>
        </span>
      </div>
    </section>
  );
}

/** Floating performance monitor with drag, snap edges, and torn-off window hand-off. */
export function PerformanceHud({ detached = false }: { detached?: boolean }) {
  const { t } = useTranslation();
  const [tornOff, setTornOff] = useState(detached);
  const detachedPresentation = detached || tornOff;
  const visible = useSyncExternalStore(
    subscribePerformanceHudVisibility,
    isPerformanceHudVisible,
    isPerformanceHudVisible,
  );
  const detachedWindow = useSyncExternalStore(
    subscribePerformanceHudDetached,
    isPerformanceHudDetached,
    isPerformanceHudDetached,
  );
  const snapshot = useSyncExternalStore(
    subscribePerformanceHudSnapshot,
    getPerformanceHudSnapshot,
    getPerformanceHudSnapshot,
  );
  const snapEdges = useSyncExternalStore(
    subscribePerformanceHudSnapEdges,
    getPerformanceHudSnapEdges,
    getPerformanceHudSnapEdges,
  );
  const [position, setPosition] = useState(() => performanceHudPosition.get());
  const panel = useRef<HTMLDivElement>(null);
  const redocking = useRef(false);
  const inspectingMove = useRef(false);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    position: PerformanceHudPosition;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenForPerformanceHudDock(() => {
      if (active) {
        setPerformanceHudDetached(false);
        if (!detached) {
          setTornOff(false);
        }
        setPerformanceHudSnapEdges({ top: false, right: false, bottom: false, left: false });
        window.dispatchEvent(new Event("performance-hud-docked"));
      }
    })
      .then((dispose) => {
        if (active) {
          unlisten = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [detached]);

  useEffect(() => {
    if (detached) {
      return;
    }
    let active = true;
    let unlisten: (() => void) | undefined;
    void listenForPerformanceHudSnapEdges((payload) => {
      if (active) {
        setPerformanceHudSnapEdges(payload);
      }
    })
      .then((dispose) => {
        if (active) {
          unlisten = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [detached]);

  useEffect(() => {
    if (!detached) {
      return;
    }
    let active = true;
    let unlistenFrames: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    void listenForPerformanceHudFrames((payload) => {
      if (active) {
        setPerformanceHudSnapshot(payload);
      }
    })
      .then((dispose) => {
        if (active) {
          unlistenFrames = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => {});
    /** Inspects the latest pending window move, one inspection at a time. */
    const inspectLatestMove = () => {
      if (!active || inspectingMove.current || !pendingMove.current) {
        return;
      }
      const windowPosition = pendingMove.current;
      pendingMove.current = null;
      inspectingMove.current = true;
      void inspectTornOffPerformanceHud(windowPosition)
        .then((state) => {
          if (!active) {
            return;
          }
          void publishPerformanceHudSnapEdges(state.snapEdges).catch(() => {});
          if (!state.shouldRedock || redocking.current) {
            return;
          }
          redocking.current = true;
          return announcePerformanceHudDock().then(closeTornOffPerformanceHud);
        })
        .catch(() => {})
        .finally(() => {
          inspectingMove.current = false;
          inspectLatestMove();
        });
    };
    void listenForTornOffPerformanceHudMove((windowPosition) => {
      pendingMove.current = windowPosition;
      inspectLatestMove();
    })
      .then((dispose) => {
        if (active) {
          unlistenMove = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => {});
    void listenForTornOffPerformanceHudClose(() => {
      if (active) {
        setPerformanceHudDetached(false);
        void announcePerformanceHudDock().catch(() => {});
      }
    })
      .then((dispose) => {
        if (active) {
          unlistenClose = dispose;
        } else {
          dispose();
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      unlistenFrames?.();
      unlistenMove?.();
      unlistenClose?.();
    };
  }, [detached]);

  useEffect(() => {
    if (!detachedPresentation || visible) {
      return;
    }
    void announcePerformanceHudDock()
      .then(closeTornOffPerformanceHud)
      .catch(() => {});
  }, [detachedPresentation, visible]);

  useEffect(() => {
    /** Drops the torn-off presentation when the native window reports a dock. */
    const onDocked = () => {
      if (detachedPresentation) {
        setTornOff(false);
        return;
      }
    };
    window.addEventListener("performance-hud-docked", onDocked);
    return () => window.removeEventListener("performance-hud-docked", onDocked);
  }, [detachedPresentation]);

  useEffect(() => {
    /** Re-clamps the panel after a window resize. */
    const onResize = () => {
      const next = clampPosition(position, window.innerWidth, window.innerHeight, panel.current);
      if (next.x !== position.x || next.y !== position.y) {
        setPosition(next);
        setPerformanceHudPosition(next);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position]);

  const hasSnapEdges = Object.values(snapEdges).some(Boolean);
  const snapHighlight =
    !detached && tornOff && hasSnapEdges ? (
      <div className="redux-performance-hud-snap-highlight" aria-hidden="true">
        {(["top", "right", "bottom", "left"] as const).map((edge) => (
          <i key={edge} data-edge={edge} data-active={snapEdges[edge]} />
        ))}
      </div>
    ) : null;

  if (!visible || (!detached && (tornOff || detachedWindow))) {
    return snapHighlight;
  }

  const blocks = getPerformanceHudBlocks();
  /** Starts a panel drag, or the native window drag while torn off. */
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("button, a, input, select, textarea")) {
      return;
    }
    // The panel itself is draggable; its scrollbar is not part of that gesture.
    const node = panel.current;
    if (node && event.target === node && event.nativeEvent.offsetX >= node.clientWidth) {
      return;
    }
    if (detachedPresentation) {
      event.preventDefault();
      void startTornOffPerformanceHudDrag().catch(() => {});
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      position,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  /** Moves the floating panel with the captured pointer, clamped to the viewport. */
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    const nextPosition = {
      x: event.clientX - drag.current.offsetX,
      y: event.clientY - drag.current.offsetY,
    };
    const clampedPosition = clampPosition(
      nextPosition,
      window.innerWidth,
      window.innerHeight,
      panel.current,
    );
    drag.current.position = clampedPosition;
    setPosition(clampedPosition);
  };
  /** Ends the drag and persists the final position. */
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) {
      return;
    }
    const lastPosition = drag.current.position;
    drag.current = null;
    setPerformanceHudPosition(lastPosition);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  /** Switches this surface to the detached presentation while the native window opens. */
  const onTornOff = () => {
    setTornOff(true);
  };

  return (
    <>
      {snapHighlight}
      <aside
        className={`redux-performance-hud${detachedPresentation ? " redux-performance-hud--detached" : ""}`}
        data-testid="performance-hud"
        style={{
          left: detachedPresentation ? 0 : position.x,
          top: detachedPresentation ? 0 : position.y,
        }}
        aria-label={t("chrome.performanceHud.title")}
      >
        <div
          ref={panel}
          className="redux-performance-hud-panel"
          data-tip-title={t("chrome.performanceHud.drag")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <header className="redux-performance-hud-header">
            <span>{t("chrome.performanceHud.title")}</span>
            <span className="redux-performance-hud-header-actions">
              {!detachedPresentation && <span className="redux-performance-hud-shortcut">F3</span>}
              {detachedPresentation && (
                <IconButton
                  icon="panelRight"
                  size="small"
                  variant="plain"
                  className="redux-performance-hud-dock"
                  label={t("chrome.performanceHud.dock")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    onTornOff();
                    void announcePerformanceHudDock()
                      .then(closeTornOffPerformanceHud)
                      .catch(() => {});
                  }}
                />
              )}
            </span>
          </header>
          <div className="redux-performance-hud-blocks">
            {blocks.map((block) => (
              <div className="redux-performance-hud-block" key={block.id} data-hud-block={block.id}>
                <span className="redux-performance-hud-label">{t(block.label)}</span>
                {block.kind === "text" ? (
                  <strong>{block.value(snapshot)}</strong>
                ) : (
                  <div className="redux-performance-hud-bar" aria-label={t(block.label)}>
                    {block.values(snapshot).map((value, index, values) => {
                      const maximum = Math.max(1, ...values);
                      return (
                        <i
                          key={`${index}-${value}`}
                          style={{ height: `${Math.max(4, (value / maximum) * 100)}%` }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {snapshot.collaborationTrafficActive && (
              <CollaborationTrafficGraph snapshot={snapshot} />
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
