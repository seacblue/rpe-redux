/** Installs frontend warning/error capture without exposing input or DOM data. */
import {
  recordDiagnosticAction,
  recordDiagnosticIssue,
} from "../../core/diagnostics/interactionLog.ts";

let installed = false;

/** Convert console arguments without serializing arbitrary user objects. */
function consoleMessage(args: readonly unknown[]): string {
  return args
    .map((value) => (value instanceof Error ? value.stack || value.message : String(value)))
    .join(" ");
}

/** Install the global frontend warning/error hooks once per webview. */
export function installFrontendDiagnosticCapture(): void {
  if (installed) {
    return;
  }
  installed = true;
  window.addEventListener("error", (event) => {
    recordDiagnosticIssue("error", "frontend", event.error ?? event.message, "window.error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordDiagnosticIssue("error", "frontend", event.reason, "unhandledrejection");
  });
  window.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const control = target.closest<HTMLElement>(
      "button,[role=button],[role=menuitem],[role=tab],[role=checkbox],[role=switch]",
    );
    if (!control || control.dataset.tipAction || control.id.startsWith("menu-action-")) {
      return;
    }
    const id = control.dataset.diagnosticAction ?? control.id;
    if (!/^[a-z][a-z0-9._:-]{1,95}$/iu.test(id)) {
      return;
    }
    recordDiagnosticAction(`dom.${id}`, "gesture", "completed");
  });
  const consoleObject = globalThis.console;
  const originalWarn = consoleObject.warn.bind(consoleObject);
  const originalError = consoleObject.error.bind(consoleObject);
  consoleObject.warn = (...args: unknown[]) => {
    recordDiagnosticIssue("warning", "frontend", consoleMessage(args), "console.warn");
    originalWarn(...args);
  };
  consoleObject.error = (...args: unknown[]) => {
    recordDiagnosticIssue("error", "frontend", consoleMessage(args), "console.error");
    originalError(...args);
  };
}
