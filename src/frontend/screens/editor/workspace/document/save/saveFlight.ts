/**
 * Coordinates concurrent saves without mixing their persistence intents.
 *
 * Calls with the same intent share one operation. A call with a different
 * intent waits for the active operation and then runs its own operation, so an
 * explicit save can publish the saved baseline after a quiet backup.
 */

/** The options that identify one save operation's persistence intent. */
export interface SaveFlightOptions {
  /** Saves with different intents must not receive each other's result. */
  readonly key: string;
}

/** Serializes one save operation while preserving each caller's intent. */
export function createSaveFlight<T>() {
  let active: { promise: Promise<T>; key: string } | null = null;

  /** Runs or joins one save, retrying after a different intent settles. */
  const run = (options: SaveFlightOptions, operation: () => Promise<T>): Promise<T> => {
    const current = active;
    if (current) {
      if (current.key !== options.key) {
        return current.promise.catch(() => undefined as T).then(() => run(options, operation));
      }
      return current.promise;
    }

    const promise = Promise.resolve()
      .then(operation)
      .finally(() => {
        if (active?.promise === promise) {
          active = null;
        }
      });
    active = { promise, key: options.key };
    return promise;
  };

  return {
    run,
    /** The active save, if one exists. */
    get pending(): Promise<T> | null {
      return active?.promise ?? null;
    },
  };
}
