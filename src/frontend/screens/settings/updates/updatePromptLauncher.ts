/**
 * Keeps the update store independent from the React modal implementation.
 *
 * The store can finish a background download before the modal host is mounted,
 * so requests wait here until the application binds the real prompt opener.
 */
type UpdatePromptLauncher = (version: string) => Promise<boolean>;

interface PendingPrompt {
  version: string;
  resolve: (restartNow: boolean) => void;
}

let launcher: UpdatePromptLauncher | null = null;
const pending: PendingPrompt[] = [];

/** Bind the application prompt and drain requests queued before the shell mounted. */
export function bindUpdatePromptLauncher(next: UpdatePromptLauncher): () => void {
  launcher = next;
  void drainPending();
  return () => {
    if (launcher === next) {
      launcher = null;
    }
  };
}

/** Ask the user how to handle a downloaded update package. */
export function requestUpdatePrompt(version: string): Promise<boolean> {
  if (launcher) {
    return launcher(version);
  }
  return new Promise((resolve) => {
    pending.push({ version, resolve });
  });
}

/** Resolve queued prompts in order so the modal queue never receives duplicates. */
async function drainPending(): Promise<void> {
  while (launcher && pending.length > 0) {
    const request = pending.shift();
    if (!request) {
      continue;
    }
    try {
      request.resolve(await launcher(request.version));
    } catch {
      request.resolve(false);
    }
  }
}
