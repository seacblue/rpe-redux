/** Shared cancellation guard for cooperative asynchronous operations. */

/** Throw an AbortError when an operation was cancelled between await points. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }
  throw Object.assign(new Error("Operation cancelled"), { name: "AbortError" });
}
