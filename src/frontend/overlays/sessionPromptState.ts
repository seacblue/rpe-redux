/** Pure launch-count rules for the recurring GitHub Star prompt. */

/** Show the Star prompt on every tenth application launch. */
export const SESSION_PROMPT_LAUNCH_INTERVAL = 10;

/** Convert persisted launch data into a safe non-negative integer. */
function normalizeLaunchCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Return the launch count after recording one application launch. */
export function nextLaunchCount(value: unknown): number {
  const current = normalizeLaunchCount(value);
  return current === Number.MAX_SAFE_INTEGER ? 0 : current + 1;
}

/** Whether a launch count should open the Star prompt. */
export function shouldPromptForLaunch(launchCount: number, neverRemind: boolean): boolean {
  return (
    !neverRemind &&
    launchCount > 0 &&
    Number.isSafeInteger(launchCount) &&
    launchCount % SESSION_PROMPT_LAUNCH_INTERVAL === 0
  );
}
