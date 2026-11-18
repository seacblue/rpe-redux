/**
 * Owns the authored judge-line selection expression and the splice operations
 * that edit it without merging or reordering what the user wrote.
 *
 * One token is one written piece: a line, an inclusive range with an optional
 * step, or a folder name. Resolution is a union in written order, so the first
 * occurrence of a line wins while later duplicate tokens stay in the text.
 * Adding a block removes its lines from the existing tokens and appends the
 * block; removing a block splits each affected token in place. Only the
 * programmatic token builders compact adjacent runs.
 */

/** One authored piece of a line-selection expression. */
export type LineSelectionToken =
  | { kind: "line"; line: number }
  | { kind: "range"; start: number; end: number; step: number }
  | { kind: "group"; group: number; name: string };

/** One declared judge-line folder and the lines it owns right now. */
export interface LineSelectionGroup {
  /** Index into the chart's `judgeLineGroup` list. */
  index: number;
  /** Raw chart name; the default folder has an empty name. */
  name: string;
  /** Localized name the user sees; the raw name is the fallback. */
  label?: string;
  /** Member lines in chart order. */
  indices: readonly number[];
}

/** The tokens plus the lines they resolve to after normalization. */
export interface NormalizedLineSelection {
  tokens: LineSelectionToken[];
  lines: number[];
}

const EMPTY_REMOVE: ReadonlySet<number> = new Set();

/** The name a folder token writes and matches: the localized label when set. */
export function lineSelectionGroupName(group: LineSelectionGroup): string {
  return (group.label ?? group.name).trim();
}

/** True when both lists name the same lines in the same order. */
export function sameLineOrder(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

/** Use one set for every membership test in a resolution pass. */
function availableSetOf(available: ReadonlySet<number> | readonly number[]): ReadonlySet<number> {
  return available instanceof Set ? available : new Set(available);
}

/** Case-insensitive folder lookup key; folder names are unique that way. */
function groupKey(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** The folder a group token addresses, preferring the written name on a move. */
export function findLineSelectionGroup(
  token: Extract<LineSelectionToken, { kind: "group" }>,
  groups: readonly LineSelectionGroup[],
): LineSelectionGroup | null {
  const wanted = groupKey(token.name);
  const atIndex = groups.find((group) => group.index === token.group) ?? null;
  if (atIndex && groupKey(lineSelectionGroupName(atIndex)) === wanted) {
    return atIndex;
  }
  const byName =
    wanted.length > 0
      ? (groups.find((group) => groupKey(lineSelectionGroupName(group)) === wanted) ?? null)
      : null;
  return byName ?? atIndex;
}

/** Lines one token contributes, in the token's own order. */
function resolveToken(
  token: LineSelectionToken,
  available: ReadonlySet<number>,
  groups: readonly LineSelectionGroup[],
): number[] {
  if (token.kind === "line") {
    return available.has(token.line) ? [token.line] : [];
  }
  if (token.kind === "range") {
    const start = Math.min(token.start, token.end);
    const end = Math.max(token.start, token.end);
    const step = Math.max(1, Math.floor(token.step));
    const lines: number[] = [];
    for (let line = start; line <= end; line += step) {
      if (available.has(line)) {
        lines.push(line);
      }
    }
    return lines;
  }
  const group = findLineSelectionGroup(token, groups);
  return group ? group.indices.filter((line) => available.has(line)) : [];
}

/** Resolve every token as one ordered, duplicate-free line list. */
export function resolveLineSelection(
  tokens: readonly LineSelectionToken[],
  available: ReadonlySet<number> | readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): number[] {
  const known = availableSetOf(available);
  const lines: number[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    for (const line of resolveToken(token, known, groups)) {
      if (!seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
    }
  }
  return lines;
}

/**
 * Compact programmatic lines into line and step-1 range tokens.
 *
 * The input order is preserved; only adjacent values become one range. This is
 * the fallback for callers that hold indices instead of an authored expression,
 * never the formatter for text the user typed.
 */
export function tokensFromLines(lines: readonly number[]): LineSelectionToken[] {
  const values = [...new Set(lines.filter((line) => Number.isInteger(line) && line >= 0))];
  const tokens: LineSelectionToken[] = [];
  let index = 0;
  while (index < values.length) {
    let end = index;
    while (end + 1 < values.length && values[end + 1] === values[end] + 1) {
      end += 1;
    }
    tokens.push(
      end === index
        ? { kind: "line", line: values[index] }
        : { kind: "range", start: values[index], end: values[end], step: 1 },
    );
    index = end + 1;
  }
  return tokens;
}

/** The authored tokens when they still describe `selection`, else its lines. */
export function tokensForSelection(
  tokens: readonly LineSelectionToken[],
  selection: readonly number[],
  available: ReadonlySet<number> | readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): LineSelectionToken[] {
  return sameLineOrder(resolveLineSelection(tokens, available, groups), selection)
    ? [...tokens]
    : tokensFromLines(selection);
}

/** Split one range around the removed lines, keeping the original step. */
function splitRange(
  token: Extract<LineSelectionToken, { kind: "range" }>,
  remove: ReadonlySet<number>,
  available: ReadonlySet<number>,
): LineSelectionToken[] {
  const start = Math.min(token.start, token.end);
  const end = Math.max(token.start, token.end);
  const step = Math.max(1, Math.floor(token.step));
  const full: number[] = [];
  const kept: number[] = [];
  let skipped = false;
  for (let line = start; line <= end; line += step) {
    if (!available.has(line)) {
      skipped = true;
      continue;
    }
    full.push(line);
    if (!remove.has(line)) {
      kept.push(line);
    }
  }
  if (!kept.length) {
    return [];
  }
  // No member was touched or missing: keep the written bounds, including a
  // bound that is not itself a step member (`80:119/5` still ends at 115 lines).
  if (!skipped && kept.length === full.length) {
    return [{ kind: "range", start, end, step }];
  }
  const tokens: LineSelectionToken[] = [];
  let runStart = kept[0];
  let previous = kept[0];
  const flush = (): void => {
    tokens.push(
      runStart === previous
        ? { kind: "line", line: runStart }
        : { kind: "range", start: runStart, end: previous, step },
    );
  };
  for (let index = 1; index < kept.length; index += 1) {
    const line = kept[index];
    if (line === previous + step) {
      previous = line;
      continue;
    }
    flush();
    runStart = line;
    previous = line;
  }
  flush();
  return tokens;
}

/** Split one token around removed and unavailable lines. */
function splitToken(
  token: LineSelectionToken,
  remove: ReadonlySet<number>,
  available: ReadonlySet<number>,
  groups: readonly LineSelectionGroup[],
): LineSelectionToken[] {
  if (token.kind === "line") {
    return remove.has(token.line) || !available.has(token.line) ? [] : [{ ...token }];
  }
  if (token.kind === "range") {
    return splitRange(token, remove, available);
  }
  const group = findLineSelectionGroup(token, groups);
  if (!group) {
    return [];
  }
  const full = group.indices.filter((line) => available.has(line));
  const kept = full.filter((line) => !remove.has(line));
  if (!kept.length) {
    return [];
  }
  if (kept.length === full.length) {
    // A named folder refreshes its written name after a rename. The unnamed
    // default folder keeps the localized label the caller supplied.
    return [
      {
        kind: "group",
        group: group.index,
        name: lineSelectionGroupName(group) || token.name,
      },
    ];
  }
  return tokensFromLines(kept);
}

/** Keep only valid tokens and lines, refreshing folder names from `groups`. */
export function normalizeLineSelection(
  tokens: readonly LineSelectionToken[],
  available: ReadonlySet<number> | readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): NormalizedLineSelection {
  const known = availableSetOf(available);
  const normalized = tokens.flatMap((token) => splitToken(token, EMPTY_REMOVE, known, groups));
  return {
    tokens: normalized,
    lines: resolveLineSelection(normalized, known, groups),
  };
}

/** Remove a set of lines, splitting every affected token where it stands. */
export function subtractLineSelection(
  tokens: readonly LineSelectionToken[],
  removed: readonly number[],
  available: ReadonlySet<number> | readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): LineSelectionToken[] {
  const remove = new Set(removed.filter((line) => Number.isInteger(line) && line >= 0));
  const known = availableSetOf(available);
  return tokens.flatMap((token) => splitToken(token, remove, known, groups));
}

/**
 * Add a block after removing its lines from the existing tokens.
 *
 * The new block is appended as one compact list, so repeated block additions
 * always land at the end while the earlier tokens keep their order.
 */
export function addLineSelection(
  tokens: readonly LineSelectionToken[],
  added: readonly number[],
  available: ReadonlySet<number> | readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): LineSelectionToken[] {
  const values = [...new Set(added.filter((line) => Number.isInteger(line) && line >= 0))];
  if (!values.length) {
    return [...tokens];
  }
  return [...subtractLineSelection(tokens, values, available, groups), ...tokensFromLines(values)];
}

/**
 * Add one folder: strip its members from the existing tokens, then append the
 * folder token itself at the end. An empty folder adds nothing.
 */
export function addGroupSelection(
  tokens: readonly LineSelectionToken[],
  group: LineSelectionGroup,
  available: ReadonlySet<number> | readonly number[],
  groups: readonly LineSelectionGroup[] = [],
): LineSelectionToken[] {
  const known = availableSetOf(available);
  const members = group.indices.filter((line) => known.has(line));
  if (!members.length) {
    return [...tokens];
  }
  return [
    ...subtractLineSelection(tokens, members, known, groups),
    { kind: "group", group: group.index, name: lineSelectionGroupName(group) },
  ];
}

/**
 * Whether a folder name fits in one comma-delimited token.
 *
 * Numeric and range-looking names are allowed: the parser matches a declared
 * folder before a number or range, so `3` and `0-2` round-trip as folder names.
 * A comma or parenthesis cannot be written because those separate tokens and
 * carry the active-line annotation; folder creation and rename strip them, so
 * only an imported chart can still hold one.
 */
function isWritableGroupName(name: string): boolean {
  return name.length > 0 && name === name.trim() && !/[，,()（）\r\n]/u.test(name);
}

/**
 * Write tokens back as text, one written piece per token.
 *
 * Adjacent tokens are never merged. A folder whose name contains a comma or
 * parenthesis is expanded to the lines it currently owns so the result still
 * parses to the same selection.
 */
export function formatLineSelectionTokens(
  tokens: readonly LineSelectionToken[],
  groups: readonly LineSelectionGroup[] = [],
): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.kind === "line") {
      parts.push(String(token.line));
      continue;
    }
    if (token.kind === "range") {
      if (token.start === token.end) {
        parts.push(String(token.start));
      } else if (token.step === 1) {
        parts.push(`${token.start}-${token.end}`);
      } else {
        parts.push(`${token.start}:${token.end}/${token.step}`);
      }
      continue;
    }
    if (isWritableGroupName(token.name)) {
      parts.push(token.name);
      continue;
    }
    const group = findLineSelectionGroup(token, groups);
    if (group) {
      for (const lineToken of tokensFromLines(group.indices)) {
        parts.push(formatLineSelectionTokens([lineToken], groups));
      }
    }
  }
  return parts.join(",");
}

/**
 * The text a field shows: the authored expression plus the active-line
 * annotation while more than one line is selected.
 */
export function formatLineSelectionExpression(
  tokens: readonly LineSelectionToken[],
  lines: readonly number[],
  activeLine: number,
  groups: readonly LineSelectionGroup[] = [],
): string {
  const text = formatLineSelectionTokens(tokens, groups);
  if (!text || lines.length <= 1) {
    return text;
  }
  const active = Number.isInteger(activeLine) && activeLine >= 0 ? activeLine : lines[0];
  return `${text} (${active})`;
}
