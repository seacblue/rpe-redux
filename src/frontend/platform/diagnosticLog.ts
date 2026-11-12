/**
 * Startup diagnostics.
 *
 * Thrown values become readable text and reports can be written to the desktop log
 * directory; the browser build simply skips the write.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktop } from "../../core/platform/environment.ts";
import { recordDiagnosticIssue } from "../../core/diagnostics/interactionLog.ts";

/** Preserve the useful call stack without losing non-Error thrown values. */
export function diagnosticText(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  if (error && typeof error === "object" && "stack" in error && typeof error.stack === "string") {
    return error.stack;
  }
  return String(error);
}

/** Persist a report in the desktop-owned logs directory when available. */
export async function writeDiagnosticLog(report: string): Promise<string | null> {
  if (!isDesktop()) {
    return null;
  }
  try {
    return await invoke<string>("write_diagnostic_log", { report });
  } catch (error) {
    recordDiagnosticIssue("error", "frontend", error, "diagnostic_log.write");
    console.error("[redux.diagnostics] failed to write diagnostic log", error);
    return null;
  }
}

/** Reveal the logs directory so the user can attach the generated file. */
export async function openDiagnosticLogs(): Promise<void> {
  if (!isDesktop()) {
    return;
  }
  try {
    await invoke("open_diagnostic_logs");
  } catch (error) {
    recordDiagnosticIssue("error", "frontend", error, "diagnostic_log.open");
    console.error("[redux.diagnostics] failed to open diagnostic logs", error);
  }
}
