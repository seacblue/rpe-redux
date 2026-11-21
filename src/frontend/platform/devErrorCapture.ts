/**
 * Routes uncaught browser errors into the developer findings store.
 *
 * The listeners stay installed for the session; the detector's own capture gate
 * decides whether a finding is recorded, so toggling the setting needs no
 * listener churn.
 */
import { devReportError } from "../../core/dev/checks.ts";

/** Install uncaught error and rejection listeners; returns the disposer. */
export function installDevErrorCapture(): () => void {
  const onError = (event: ErrorEvent): void => {
    devReportError("window.error", event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    devReportError("window.unhandledrejection", event.reason);
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
