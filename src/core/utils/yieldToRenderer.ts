/**
 * Cooperative yielding for long main-thread loops.
 *
 * `setTimeout(0)` is clamped to roughly 4 ms once a task has run for a while, so a
 * loop that yields thousands of times pays seconds of latency. `scheduler.yield`
 * (Chromium) reschedules without that clamp, and a `MessageChannel` message is the
 * portable fallback: it resolves as a macrotask, giving the renderer a chance to
 * paint and dispatch input, with no timer involved.
 */

/** Yield one macrotask so the renderer can paint and handle input. */
export function yieldToRenderer(): Promise<void> {
  const scheduler = (
    globalThis as typeof globalThis & { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler;
  if (scheduler?.yield) {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/**
 * Yield only when a unit of work has run past `budgetMs`, and at least once every
 * `maxChunks` units.
 *
 * The chunk cap covers the case where each unit is individually cheap but a long
 * series of them still adds up past one frame. Together they bound the longest
 * uninterrupted main-thread stretch, which is what a frame drop is.
 */
export function createWorkBudget(budgetMs: number, maxChunks: number) {
  let since = 0;
  let started = performance.now();
  return {
    /** True when the caller should yield before doing more work. */
    exhausted(): boolean {
      since += 1;
      if (since >= maxChunks) {
        return true;
      }
      return performance.now() - started >= budgetMs;
    },
    /** Reset the budget after yielding. */
    reset(): void {
      since = 0;
      started = performance.now();
    },
  };
}
