/**
 * The preview's judge-line guides: the body a line draws and the clip under it.
 *
 * A guide is a line's visual extent — position, size, tint, transparency —
 * resolved from the line state the chart runtime already computed. This module
 * reads that state and answers with plain numbers, so the geometry can be checked
 * without a canvas; painting it is `render/`'s job.
 */
import type { JudgeLine } from "../../../../../../core/global/chart/chart.ts";
import type { LineState } from "../../../../../../core/global/chart/runtime/scene.ts";

/** A judge-line guide: screen position and rotation. */
export interface LineGuide {
  index: number;
  x: number;
  y: number;
  rotation: number;
}

/** A merged guide: the line indices represented by one visible guide. */
export interface LineGuideGroup extends LineGuide {
  indices: number[];
}

/**
 * Projects each line's sampled state into a screen-space guide, writing into
 * `result` and returning the same array.
 */
export function lineGuides(
  states: readonly (LineState | undefined)[],
  lines: readonly (JudgeLine | undefined)[],
  order: readonly number[],
  centerX: number,
  centerY: number,
  scaleX: number,
  scaleY: number,
  result: LineGuide[] = [],
): LineGuide[] {
  let write = 0;
  for (const index of order) {
    const state = states[index];
    if (!state || !lines[index]) {
      continue;
    }
    const guide = result[write] ?? {
      index,
      x: 0,
      y: 0,
      rotation: 0,
    };
    guide.index = index;
    guide.x = centerX + state.x * scaleX;
    guide.y = centerY - state.y * scaleY;
    guide.rotation = state.rotation;
    result[write++] = guide;
  }
  result.length = write;
  return result;
}

type GuideGrid = Map<number, Map<number, Map<number, number[]>>>;
const guideGroupPools = new WeakMap<LineGuideGroup[], LineGuideGroup[]>();

/**
 * Merge guides that share a screen anchor.
 *
 * The index is built only once the results are large enough to be worth it; the
 * scan still picks the earliest matching group so labels and selected arrows
 * keep the same order.
 */
export function mergeGuides(
  guides: readonly LineGuide[],
  scale: number,
  enabled = true,
): LineGuideGroup[] {
  return mergeGuidesInto(guides, scale, enabled, []);
}

/** Merge guides into caller-owned groups so repeated preview frames avoid group allocations. */
export function mergeGuidesInto(
  guides: readonly LineGuide[],
  scale: number,
  enabled: boolean,
  groups: LineGuideGroup[],
): LineGuideGroup[] {
  const pool = guideGroupPools.get(groups) ?? [];
  for (const group of groups) {
    group.indices.length = 0;
    pool.push(group);
  }
  groups.length = 0;
  const radius = 10 * scale;
  const indexable = enabled && guides.length >= 64 && Number.isFinite(radius) && radius > 0;
  let grid: GuideGrid | null = null;
  /** Adds a group to the spatial index under its anchor cell. */
  const insert = (target: GuideGrid, guide: LineGuide, index: number): void => {
    if (
      !Number.isFinite(guide.x) ||
      !Number.isFinite(guide.y) ||
      !Number.isFinite(guide.rotation)
    ) {
      return;
    }
    const x = Math.floor(guide.x / radius);
    const y = Math.floor(guide.y / radius);
    const rotation = Math.floor(guide.rotation / 0.01);
    let column = target.get(x);
    if (!column) {
      column = new Map();
      target.set(x, column);
    }
    let cell = column.get(y);
    if (!cell) {
      cell = new Map();
      column.set(y, cell);
    }
    let bucket = cell.get(rotation);
    if (!bucket) {
      bucket = [];
      cell.set(rotation, bucket);
    }
    bucket.push(index);
  };
  for (const guide of guides) {
    let group: LineGuideGroup | undefined;
    // A handful of shared anchors is cheaper to scan directly; only build the
    // index when the number of distinct groups actually grows.
    if (!grid && indexable && groups.length >= 32) {
      const built: GuideGrid = new Map();
      grid = built;
      groups.forEach((candidate, index) => insert(built, candidate, index));
    }
    const indexed =
      grid !== null &&
      Number.isFinite(guide.x) &&
      Number.isFinite(guide.y) &&
      Number.isFinite(guide.rotation);
    if (grid && indexed) {
      const x = Math.floor(guide.x / radius);
      const y = Math.floor(guide.y / radius);
      const rotation = Math.floor(guide.rotation / 0.01);
      let first = Number.POSITIVE_INFINITY;
      for (let dx = -1; dx <= 1; dx++) {
        const column = grid.get(x + dx);
        if (!column) {
          continue;
        }
        for (let dy = -1; dy <= 1; dy++) {
          const cell = column.get(y + dy);
          if (!cell) {
            continue;
          }
          for (let dr = -1; dr <= 1; dr++) {
            const bucket = cell.get(rotation + dr);
            if (!bucket) {
              continue;
            }
            for (const index of bucket) {
              const candidate = groups[index];
              if (
                index < first &&
                Math.abs(candidate.rotation - guide.rotation) < 0.01 &&
                Math.hypot(candidate.x - guide.x, candidate.y - guide.y) < radius
              ) {
                group = candidate;
                first = index;
              }
            }
          }
        }
      }
    } else if (enabled) {
      group = groups.find(
        (candidate) =>
          Math.hypot(candidate.x - guide.x, candidate.y - guide.y) < radius &&
          Math.abs(candidate.rotation - guide.rotation) < 0.01,
      );
    }
    if (group) {
      group.indices.push(guide.index);
    } else {
      if (grid && indexed) {
        insert(grid, guide, groups.length);
      }
      const next = pool.pop() ?? { ...guide, indices: [] };
      next.index = guide.index;
      next.x = guide.x;
      next.y = guide.y;
      next.rotation = guide.rotation;
      next.indices.push(guide.index);
      groups.push(next);
    }
  }
  guideGroupPools.set(groups, pool);
  return groups;
}

/**
 * Formats line indices as comma-separated ranges; child lines keep their
 * parent in parentheses and never join a range.
 */
export function formatLineNumbers(
  indices: readonly number[],
  lines: readonly JudgeLine[] | null = null,
): string {
  const sorted = [...indices].sort((left, right) => left - right);
  const groups: string[] = [];
  for (let index = 0; index < sorted.length; index++) {
    const first = sorted[index];
    let last = first;
    const firstParent = Number(lines?.[first]?.father ?? -1);
    while (
      firstParent < 0 &&
      sorted[index + 1] === last + 1 &&
      Number(lines?.[sorted[index + 1]]?.father ?? -1) < 0
    ) {
      last = sorted[++index];
    }
    const suffix = firstParent >= 0 ? `(${firstParent})` : "";
    groups.push(last === first ? `${first}${suffix}` : `${first}–${last}`);
  }
  return groups.join(", ");
}
