/**
 * Modal that reports host/guest room setup and required asset transfer.
 *
 * It mirrors the chart-loading surface: one status line, one continuous
 * progress bar, and a percentage. The provider decides when the room is ready;
 * manual close always asks the provider to abort the in-flight operation and
 * clear transfer buffers.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { Modal } from "../../../../../design/components/modal/Modal.tsx";
import { Progress } from "../../../../../design/components/progress/Progress.tsx";
import { useTranslation, type Translator } from "../../../../../i18n/react.ts";
import {
  assetProgressRatio,
  collaborationProgress,
  type CollaborationProgressAsset,
  type CollaborationProgressState,
} from "../../../../../core/collaboration/progress.ts";
import { useCollaboration } from "./collaborationRuntime.tsx";

/** Current phase as one continuous bar, matching the chart-loading surface. */
function progressRatio(progress: CollaborationProgressState): number {
  if (progress.ready) {
    return 1;
  }
  if (!progress.visible) {
    return 0;
  }
  switch (progress.phase) {
    case "preparing":
      return 0.05;
    case "bridge":
      return progress.detail === "ready" || progress.detail === "reuse" ? 0.35 : 0.2;
    case "connecting":
      return progress.role === "host" ? 0.45 : 0.15;
    case "waiting":
      return 0.25;
    case "chart":
      return 0.4;
    case "publishing":
      return 0.7;
    case "assets": {
      if (!progress.assets.length) {
        return 0.45;
      }
      const assets =
        progress.assets.reduce((sum, asset) => sum + assetProgressRatio(asset), 0) /
        progress.assets.length;
      return 0.45 + assets * 0.5;
    }
    case "error":
      return 0;
    default:
      return 0;
  }
}

/** Pick the current asset row for the one status line. */
function activeAsset(
  assets: readonly CollaborationProgressAsset[],
): CollaborationProgressAsset | undefined {
  return assets.find((asset) => asset.state !== "done") ?? assets.at(-1);
}

/** Translate the current host/guest phase into one short status line. */
function statusText(progress: CollaborationProgressState, translator: Translator): string {
  if (progress.ready) {
    return translator.t("workspace.collaboration.progress.status.ready");
  }
  const { t, tRaw } = translator;
  if (progress.role === "host") {
    if (progress.phase === "preparing") {
      return t("workspace.collaboration.progress.status.preparing");
    }
    if (progress.phase === "bridge") {
      if (progress.mode === "lan") {
        return t("workspace.collaboration.progress.status.bridgeLan");
      }
      const tunnel: Record<string, string> = {
        resolve: "workspace.collaboration.progress.status.tunnelResolve",
        start: "workspace.collaboration.progress.status.tunnelStart",
        wait: "workspace.collaboration.progress.status.tunnelWait",
        ready: "workspace.collaboration.progress.status.tunnelReady",
        reuse: "workspace.collaboration.progress.status.tunnelReuse",
        error: "workspace.collaboration.progress.status.tunnelError",
      };
      const key = tunnel[progress.detail];
      return key ? tRaw(key) : t("workspace.collaboration.progress.status.bridgeTunnel");
    }
    if (progress.phase === "connecting") {
      return t("workspace.collaboration.progress.status.connect");
    }
    if (progress.phase === "publishing") {
      return t("workspace.collaboration.progress.status.publish");
    }
    return t("workspace.collaboration.progress.status.preparing");
  }
  if (progress.phase === "connecting") {
    return t("workspace.collaboration.progress.status.connect");
  }
  if (progress.phase === "waiting") {
    return t("workspace.collaboration.progress.status.waiting");
  }
  if (progress.phase === "chart") {
    return t("workspace.collaboration.progress.status.chart");
  }
  if (progress.phase === "assets") {
    const asset = activeAsset(progress.assets);
    if (!asset) {
      return t("workspace.collaboration.progress.status.assets");
    }
    return asset.kind === "audio"
      ? t("workspace.collaboration.progress.status.audio")
      : t("workspace.collaboration.progress.status.background");
  }
  return t("workspace.collaboration.progress.status.connect");
}

/** Ease the displayed value toward a new target so the bar never jumps. */
function useSmoothRatio(target: number, active: boolean): number {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (!active) {
      current.current = target;
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = target;
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    const start = current.current;
    const boundedTarget = active ? Math.max(target, start) : target;
    if (Math.abs(boundedTarget - start) < 0.001) {
      current.current = boundedTarget;
      setValue(boundedTarget);
      return;
    }
    const duration = 500;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      const next = start + (boundedTarget - start) * eased;
      current.current = next;
      setValue(next);
      if (elapsed < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active]);
  return value;
}

/** The room setup progress dialog; close aborts until the room is ready. */
export function RoomProgressDialog() {
  const translator = useTranslation();
  const { t } = translator;
  const { abortRoomProgress, dismissRoomProgress } = useCollaboration();
  const progress = useSyncExternalStore(
    collaborationProgress.subscribe,
    collaborationProgress.get,
    collaborationProgress.get,
  );
  const ratio = useSmoothRatio(progressRatio(progress), progress.visible);
  const percent = Math.round(ratio * 100);
  const close = () => {
    if (progress.ready) {
      dismissRoomProgress();
    } else {
      abortRoomProgress();
    }
  };
  useEffect(() => {
    if (!progress.visible || !progress.ready) {
      return;
    }
    const timer = window.setTimeout(dismissRoomProgress, 1_200);
    return () => window.clearTimeout(timer);
  }, [progress.visible, progress.ready, dismissRoomProgress]);

  return (
    <Modal
      open={progress.visible}
      onClose={close}
      label={t(
        progress.role === "host"
          ? "workspace.collaboration.progress.hostTitle"
          : "workspace.collaboration.progress.guestTitle",
      )}
      className="redux-prompt-dialog collab-progress-dialog"
      dismissOnScrim={false}
      requestClose={async () => {
        close();
        return true;
      }}
    >
      <div className="collab-progress-overall" role="status" data-state={progress.phase}>
        <p className="collab-progress-stage" aria-live="polite">
          {statusText(progress, translator)}...
        </p>
        <Progress
          value={ratio}
          max={1}
          label={t("workspace.collaboration.progress.title")}
          valueText={`${percent}%`}
        />
        <p className="collab-progress-percent">{percent}%</p>
      </div>
      {progress.error && (
        <InlineAlert tone="danger" className="collab-progress-error">
          {progress.error}
        </InlineAlert>
      )}
    </Modal>
  );
}
