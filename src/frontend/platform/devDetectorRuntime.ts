/**
 * Keeps developer capture in sync with the host policy and the settings switch.
 *
 * It also installs the browser error listeners once. No React state is involved:
 * the overlay subscribes to the findings store directly.
 */
import { setDevCaptureEnabled } from "../../core/dev/detector.ts";
import { developerMode } from "../../core/platform/desktop/developer.ts";
import { devDetectorEnabled } from "../../core/state/devDetector.ts";
import { developerReveal, isDeveloperRevealed } from "../../core/state/developerReveal.ts";
import { installDevErrorCapture } from "./devErrorCapture.ts";

/** Whether the host or the About-page gesture has opened developer tools. */
export function isDeveloperSurfaceOpen(): boolean {
  return developerMode.get() || isDeveloperRevealed();
}

/** Start mirroring the developer gates into the detector; returns a disposer. */
export function initializeDevDetectorRuntime(): () => void {
  const sync = (): void => {
    setDevCaptureEnabled(isDeveloperSurfaceOpen() && devDetectorEnabled.get());
  };
  const disposers = [
    developerMode.subscribe(sync),
    devDetectorEnabled.subscribe(sync),
    developerReveal.subscribe(sync),
  ];
  sync();
  const disposeErrors = installDevErrorCapture();
  return () => {
    disposeErrors();
    for (const dispose of disposers) {
      dispose();
    }
  };
}
