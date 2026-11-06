/** Adapt a cancellable package download into the retained long-task surface. */
import { startLongTask, type LongTaskContext } from "./longTasks.ts";

/** The terminal result observed by the download owner. */
export type DownloadTaskOutcome =
  | { status: "completed"; version: string }
  | { status: "cancelled" }
  | { status: "failed"; error: unknown };

/** A task handle that exposes the retained row and its terminal result. */
export interface DownloadTaskHandle {
  readonly id: string;
  readonly done: Promise<DownloadTaskOutcome>;
}

/** Download callback used by the long-task adapter and by deterministic mocks. */
export type DownloadTaskRunner = (
  signal: AbortSignal,
  report: LongTaskContext["report"],
) => Promise<string>;

/** Start one package download as a progress-reporting, cancellable long task. */
export function startDownloadTask(options: {
  label: string;
  stage: string;
  run: DownloadTaskRunner;
}): DownloadTaskHandle {
  let settle!: (outcome: DownloadTaskOutcome) => void;
  const done = new Promise<DownloadTaskOutcome>((resolve) => {
    settle = resolve;
  });
  let id = "";
  try {
    id = startLongTask({
      label: options.label,
      stage: options.stage,
      async run(context) {
        try {
          const version = await options.run(context.signal, context.report);
          if (context.signal.aborted) {
            settle({ status: "cancelled" });
            return;
          }
          settle({ status: "completed", version });
        } catch (error) {
          settle(context.signal.aborted ? { status: "cancelled" } : { status: "failed", error });
          throw error;
        }
      },
    });
  } catch (error) {
    settle({ status: "failed", error });
  }
  return { id, done };
}
