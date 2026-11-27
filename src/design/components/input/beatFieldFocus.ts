/** Decide whether a BeatField blur still belongs to one composed control. */

const scopedCommits = new Map<string, Set<() => void>>();

/** Commit every deferred BeatField registered for one inspector scope. */
export function commitBeatFieldScope(scope: string): void {
  for (const commit of [...(scopedCommits.get(scope) ?? [])]) {
    commit();
  }
}

/** Release an owner's draft guard before flushing its deferred BeatFields. */
export function flushBeatFieldScope(scope: string, releaseDraft: () => void): void {
  releaseDraft();
  commitBeatFieldScope(scope);
}

/** Register one deferred BeatField commit and return its disposer. */
export function registerBeatFieldScopeCommit(scope: string, commit: () => void): () => void {
  let commits = scopedCommits.get(scope);
  if (!commits) {
    commits = new Set();
    scopedCommits.set(scope, commits);
  }
  commits.add(commit);
  return () => {
    commits?.delete(commit);
    if (commits && !commits.size) {
      scopedCommits.delete(scope);
    }
  };
}

/** Minimal DOM boundary used by the focus-transition policy. */
export interface FocusBoundary {
  /** Whether the boundary contains the candidate focus target. */
  contains(candidate: unknown): boolean;
}

/**
 * Whether focus moved to another part of the same composed field.
 *
 * Browsers normally provide `relatedTarget` for a focus transition. Some WebView
 * paths leave it empty, so a deferred blur also compares the active element with
 * the input that lost focus. The original input staying active means the author
 * clicked a non-focusable area outside the field and the draft must commit.
 */
export function remainsWithinBeatField(
  boundary: FocusBoundary | null,
  relatedTarget: unknown,
  previousTarget: unknown,
  activeElement: unknown,
): boolean {
  if (!boundary) {
    return false;
  }
  if (relatedTarget !== null && relatedTarget !== undefined) {
    return boundary.contains(relatedTarget);
  }
  return activeElement !== previousTarget && boundary.contains(activeElement);
}
