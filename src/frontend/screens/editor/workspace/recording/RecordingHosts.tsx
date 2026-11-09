/** Application-owned offscreen hosts keep recordings alive across workspace changes. */
import { useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties } from "react";
import { t } from "../../../../../i18n/index.ts";
import { recordingError } from "./recordingErrors.ts";
import { startLongTask } from "../../../../../core/state/longTasks.ts";
import {
  runRecording,
  type RecordingJobOptions,
  type RecordingStage,
  type captureRecording,
} from "./recordingJob.ts";
import type { OffscreenPreviewSurface as RecordingSurface } from "../preview/frame/offscreenPreview.ts";

type Snapshot = ReturnType<typeof captureRecording>;
type Entry = { id: string; width: number; height: number; ready(surface: RecordingSurface): void };
let entries: readonly Entry[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getSnapshot = () => entries;
/** Publishes one recording host entry to the mounted host list. */
function publish(next: readonly Entry[]) {
  entries = next;
  listeners.forEach((listener) => listener());
}
const stages: Record<RecordingStage, string> = {
  preparing: "editor.recording.preparing",
  audio: "editor.recording.audio",
  frames: "editor.recording.frames",
  encoding: "editor.recording.encoding",
};

/** Queue a prepared immutable snapshot and retain its host through cleanup. */
export function startRecordingTask(snapshot: Snapshot, options: RecordingJobOptions): void {
  const id = crypto.randomUUID();
  let ready!: (surface: RecordingSurface) => void;
  const surface = new Promise<RecordingSurface>((resolve) => {
    ready = resolve;
  });
  startLongTask({
    label: "editor.recording.title",
    detail: options.path,
    stage: stages.preparing,
    async run({ signal, report, setDetail }) {
      try {
        const host = await surface;
        await runRecording(
          snapshot,
          host,
          options,
          signal,
          (stage, progress) => report(stages[stage], progress),
          (path) => setDetail(t("editor.recording.partialPath", { path })),
        );
      } catch (reason) {
        throw new Error(recordingError(reason), { cause: reason });
      } finally {
        setDetail(options.path);
        publish(entries.filter((entry) => entry.id !== id));
      }
    },
  });
  publish([...entries, { id, width: options.width, height: options.height, ready }]);
}

/** Offscreen canvas stack for one recording; resolves the host when mounted. */
function Host({ entry }: { entry: Entry }) {
  const primary = useRef<HTMLCanvasElement>(null);
  const notes = useRef<HTMLCanvasElement>(null);
  const shader = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const output = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (primary.current && notes.current && shader.current && overlay.current && output.current) {
      entry.ready({
        primary: primary.current,
        notes: notes.current,
        shader: shader.current,
        overlay: overlay.current,
        output: output.current,
      });
    }
  }, [entry]);
  const ratio = globalThis.devicePixelRatio || 1;
  const host: CSSProperties = {
    position: "fixed",
    left: "-100000px",
    top: 0,
    width: entry.width / ratio,
    height: entry.height / ratio,
    opacity: 0,
    pointerEvents: "none",
  };
  const canvas: CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };
  return (
    <div style={host} aria-hidden="true">
      <canvas style={canvas} ref={primary} aria-hidden="true" />
      <canvas style={canvas} ref={notes} aria-hidden="true" />
      <canvas style={canvas} ref={shader} aria-hidden="true" />
      <canvas style={canvas} ref={overlay} aria-hidden="true" />
      <canvas style={canvas} ref={output} aria-hidden="true" />
    </div>
  );
}

/** Hosts are mounted once at the application frame, outside mode-specific workspaces. */
export function RecordingHosts() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <>
      {active.map((entry) => (
        <Host key={entry.id} entry={entry} />
      ))}
    </>
  );
}
