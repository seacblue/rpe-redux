/**
 * The developer overlay.
 *
 * It keeps the developer tools deliberately small: a preview probe with a
 * one-line readout and the diagnostics panel. Selection, preview-frame, and
 * combined reports are copied through shortcuts instead of adding another
 * persistent frontend surface.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { IconButton } from "../../../../design/components/button/IconButton.tsx";
import { showToast } from "../../../../design/patterns/ToastHost.tsx";
import { t } from "../../../../i18n/index.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import type { ActionResult } from "../../../../core/edit/operations/result.ts";
import { captureDiagnosticsSnapshot } from "../../../../core/diagnostics/snapshot.ts";
import { developerMode } from "../../../../core/platform/desktop/developer.ts";
import { chart } from "../../../../core/api/chart.ts";
import { selection } from "../../../../core/api/selection.ts";
import type { SelectionApiSnapshot } from "../../../../core/edit/selection/api.ts";
import { getHitTestApi, type HitTestResult } from "../../../../core/edit/hitTest/api.ts";
import { getPreviewApi, type PreviewSnapshot } from "../../../../core/edit/preview/api.ts";
import { useTimelineDomSurface } from "../../../screens/editor/workspace/timeline/surface/TimelineDomSurface.tsx";

interface DeveloperOverlayState {
  readonly diagnostics: ReturnType<typeof captureDiagnosticsSnapshot> | null;
  readonly probe: boolean;
  readonly probePoint: { readonly x: number; readonly y: number } | null;
  readonly probeHits: readonly HitTestResult[];
  readonly probeIndex: number;
}

const initialState: DeveloperOverlayState = {
  diagnostics: null,
  probe: false,
  probePoint: null,
  probeHits: [],
  probeIndex: 0,
};

let state = initialState;
const listeners = new Set<() => void>();

/** Replaces part of the overlay state and notifies subscribers. */
function setState(next: Partial<DeveloperOverlayState>): void {
  state = { ...state, ...next };
  for (const listener of [...listeners]) {
    listener();
  }
}

/** Subscribes to overlay state changes; returns the unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Returns the current overlay state snapshot. */
function getSnapshot(): DeveloperOverlayState {
  return state;
}

/** Copies text and reports success or failure through the shared toast stack. */
function copyText(text: string): boolean {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    showToast({ message: t("chrome.developer.copyFailed"), level: "error" });
    return false;
  }
  void navigator.clipboard.writeText(text).then(
    () => showToast({ message: t("chrome.developer.copySucceeded"), level: "success" }),
    () => showToast({ message: t("chrome.developer.copyFailed"), level: "error" }),
  );
  return true;
}

/** A detached chart snapshot for joining selection and preview debug rows. */
function chartSnapshot(): unknown | null {
  const result = chart.snapshot();
  return result.ok ? result.value : null;
}

/** Current selection with the authored note objects it points at. */
function selectionPayload(): {
  selection: SelectionApiSnapshot;
  notes: readonly unknown[];
} | null {
  const selected = selection.state();
  if (!selected.ok) {
    return null;
  }
  const snapshot = selected.value;
  const chartValue = chartSnapshot() as {
    judgeLineList?: readonly {
      notes?: readonly unknown[];
    }[];
  } | null;
  const notes = snapshot.notes.map((ref) => ({
    ...ref,
    note: chartValue?.judgeLineList?.[ref.lineIndex]?.notes?.[ref.index] ?? null,
  }));
  return { selection: snapshot, notes };
}

/** A stable identity for one hit, used while the pointer moves. */
function sameHit(left: HitTestResult, right: HitTestResult): boolean {
  return (
    left.kind === right.kind &&
    left.objectId === right.objectId &&
    left.lineIndex === right.lineIndex &&
    left.noteIndex === right.noteIndex &&
    left.eventType === right.eventType &&
    left.eventIndex === right.eventIndex
  );
}

/** One hit with the authored note object when the hit names one. */
function describeHit(hit: HitTestResult): unknown {
  if (hit.kind !== "note" || hit.noteIndex === undefined) {
    return hit;
  }
  const chartValue = chartSnapshot() as {
    judgeLineList?: readonly {
      notes?: readonly unknown[];
    }[];
  } | null;
  return {
    ...hit,
    note: chartValue?.judgeLineList?.[hit.lineIndex]?.notes?.[hit.noteIndex] ?? null,
  };
}

/** A compact preview snapshot for the developer report. */
function previewPayload(preview: PreviewSnapshot | null): unknown {
  if (!preview) {
    return null;
  }
  return {
    revision: preview.revision,
    seconds: preview.seconds,
    width: preview.width,
    height: preview.height,
    scale: preview.scale,
    devicePixelRatio: preview.devicePixelRatio,
    objects: preview.objects.slice(0, 128).map((object) => ({
      id: object.id,
      kind: object.kind,
      lineIndex: object.lineIndex,
      noteIndex: object.noteIndex,
      debug: object.debug ?? null,
      client: object.client.head,
      width: object.width,
      height: object.height,
      rotation: object.rotation,
      radius: object.radius,
    })),
  };
}

/** Toggles the preview pointer probe; requires developer mode. */
export function toggleDeveloperProbe(): ActionResult {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  setState({
    probe: !state.probe,
    probeHits: [],
    probePoint: null,
    probeIndex: 0,
  });
  return { status: "committed" };
}

/** Copies the active hit under the developer probe; requires developer mode. */
export function copyProbeHit(): ActionResult {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  const hit = state.probeHits[state.probeIndex];
  if (!hit) {
    return { status: "unavailable", reason: "invalid_input", message: "No probe hit" };
  }
  const copied = copyText(JSON.stringify(describeHit(hit), null, 2));
  return copied
    ? { status: "committed" }
    : { status: "unavailable", reason: "clipboard_unavailable" };
}

/** Copies the current editor selection with the notes it references. */
export function copySelection(): ActionResult {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  const payload = selectionPayload();
  if (!payload) {
    return { status: "unavailable", reason: "invalid_input", message: "No selection runtime" };
  }
  const copied = copyText(JSON.stringify(payload, null, 2));
  return copied
    ? { status: "committed" }
    : { status: "unavailable", reason: "clipboard_unavailable" };
}

/** Copies a combined selection, probe, preview, and diagnostics report. */
export function copyDeveloperReport(): ActionResult {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  const payload = {
    selection: selectionPayload(),
    preview: previewPayload(getPreviewApi()?.snapshot() ?? null),
    probe: {
      point: state.probePoint,
      index: state.probeIndex,
      hits: state.probeHits.map(describeHit),
    },
    diagnostics: captureDiagnosticsSnapshot(),
  };
  const copied = copyText(JSON.stringify(payload, null, 2));
  return copied
    ? { status: "committed" }
    : { status: "unavailable", reason: "clipboard_unavailable" };
}

/** Captures a diagnostics snapshot into the overlay; requires developer mode. */
export function showDiagnostics(): ActionResult {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  try {
    setState({ diagnostics: captureDiagnosticsSnapshot() });
    return { status: "committed" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "diagnostics_unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Removes the diagnostics panel from the overlay. */
export function hideDiagnostics(): void {
  setState({ diagnostics: null });
}

/** Copies a fresh diagnostics snapshot as JSON; requires developer mode. */
export function copyDiagnostics(): ActionResult {
  if (!developerMode.get()) {
    return { status: "unavailable", reason: "developer_mode_disabled" };
  }
  const copied = copyText(JSON.stringify(captureDiagnosticsSnapshot(), null, 2));
  return copied
    ? { status: "committed" }
    : { status: "unavailable", reason: "clipboard_unavailable" };
}

/** Draws the probe readout and diagnostics panel. */
export function DeveloperToolsOverlay() {
  const { t: translate } = useTranslation();
  const {
    refs: { stage },
  } = useTimelineDomSurface();
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const diagnosticsRef = useRef<HTMLElement>(null);

  // The diagnostics panel is a manual popover: the browser's top layer is above
  // modal dialogs, so diagnostics stays visible even while Settings or another
  // dialog is open.
  useLayoutEffect(() => {
    const node = diagnosticsRef.current;
    if (!node || !current.diagnostics) {
      return;
    }
    try {
      node.showPopover();
    } catch {
      // Popover support is optional; the panel keeps its fixed z-index otherwise.
    }
  }, [current.diagnostics]);

  useEffect(() => {
    if (!current.probe) {
      return;
    }
    document.body.classList.add("developer-probe-active");
    const move = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const api = getHitTestApi();
      if (!target || !stage.current?.contains(target) || !api) {
        setState({ probePoint: null, probeHits: [], probeIndex: 0 });
        return;
      }
      const hits = api.pick({
        surface: "preview",
        point: { x: event.clientX, y: event.clientY },
        mode: "all",
        tolerance: 10,
      });
      const previous = state.probeHits[state.probeIndex];
      const index = previous
        ? Math.max(
            0,
            hits.findIndex((hit) => sameHit(hit, previous)),
          )
        : 0;
      setState({
        probePoint: { x: event.clientX, y: event.clientY },
        probeHits: hits,
        probeIndex: index,
      });
    };
    const wheel = (event: WheelEvent) => {
      if (!event.altKey || state.probeHits.length < 2) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY > 0 ? 1 : -1;
      setState({
        probeIndex:
          (state.probeIndex + direction + state.probeHits.length) % state.probeHits.length,
      });
    };
    const select = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !stage.current?.contains(target) || !state.probeHits.length) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      copyProbeHit();
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setState({ probe: false, probeHits: [], probePoint: null, probeIndex: 0 });
      }
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("wheel", wheel, { capture: true, passive: false });
    window.addEventListener("click", select, true);
    window.addEventListener("keydown", cancel, true);
    return () => {
      document.body.classList.remove("developer-probe-active");
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("click", select, true);
      window.removeEventListener("keydown", cancel, true);
    };
  }, [current.probe, stage]);

  const activeHit = current.probeHits[current.probeIndex] ?? null;

  return (
    <>
      {current.probe && (
        <div className="redux-developer-probe-hint" role="status">
          {activeHit
            ? `${activeHit.kind}, ${activeHit.lineIndex}${
                activeHit.noteIndex !== undefined ? `:${activeHit.noteIndex}` : ""
              }, ${current.probeIndex + 1}/${current.probeHits.length}`
            : translate("chrome.developer.probeEmpty")}
          <span>{translate("chrome.developer.probeHint")}</span>
        </div>
      )}
      {current.probe && current.probePoint && (
        <div
          className="redux-developer-probe-point"
          style={{ left: current.probePoint.x, top: current.probePoint.y }}
          aria-hidden="true"
        />
      )}
      {current.diagnostics && (
        <section
          ref={diagnosticsRef}
          popover="manual"
          className="redux-developer-diagnostics"
          role="dialog"
          aria-modal="true"
        >
          <header className="redux-developer-diagnostics-header">
            <h2>{translate("chrome.developer.diagnosticsTitle")}</h2>
            <IconButton
              icon="close"
              label={translate("chrome.developer.closeDiagnostics")}
              onClick={hideDiagnostics}
            />
          </header>
          <pre className="redux-developer-diagnostics-content">
            {JSON.stringify(current.diagnostics, null, 2)}
          </pre>
        </section>
      )}
    </>
  );
}
