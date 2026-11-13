/** Chooses which event value groups and curves fit in the visible event field. */
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import type { EventChain } from "../../../../../../core/edit/timeline/eventChains.ts";

const EVENT_VALUE_LABEL_SPACING = 28;
const EVENT_CURVE_DENSITY = 0.1;

export interface EventLabelBounds {
  readonly top: number;
  readonly bottom: number;
}

type EventGroup = EventChain<JudgeLineEvent>;

/** Reusable storage for one event-label layout pass. */
export interface EventLabelScratch {
  readonly visible: EventGroup[];
  readonly seen: Set<EventGroup>;
  centers: number[];
  selected: Uint8Array;
  readonly kept: number[];
  readonly keptCenters: number[];
  ordered: number[];
  keptFlags: Uint8Array;
  readonly result: EventGroup[];
}

/** Create empty storage for repeated event-label layout passes. */
export function createEventLabelScratch(): EventLabelScratch {
  return {
    visible: [],
    seen: new Set<EventGroup>(),
    centers: [],
    selected: new Uint8Array(),
    kept: [],
    keptCenters: [],
    ordered: [],
    keptFlags: new Uint8Array(),
    result: [],
  };
}

/** Collect unique groups without creating an intermediate mapped array. */
function uniqueGroups(groups: Iterable<EventGroup | undefined>): EventGroup[] {
  const visible: EventGroup[] = [];
  const seen = new Set<EventGroup>();
  for (const group of groups) {
    if (group !== undefined && !seen.has(group)) {
      seen.add(group);
      visible.push(group);
    }
  }
  return visible;
}

/** Select visible groups after the input has already been deduplicated. */
function selectLabelGroups(
  visible: EventGroup[],
  height: number,
  isSelected: (group: EventGroup) => boolean,
  boundsFor?: (group: EventGroup) => EventLabelBounds,
  scratch?: EventLabelScratch,
): EventGroup[] {
  const budget = Math.max(1, Math.floor(Math.max(0, height - 23) / EVENT_VALUE_LABEL_SPACING));
  if (boundsFor) {
    const centers = scratch?.centers ?? new Array<number>(visible.length);
    centers.length = visible.length;
    let selected = scratch?.selected ?? new Uint8Array();
    if (selected.length < visible.length) {
      selected = new Uint8Array(visible.length);
      if (scratch) {
        scratch.selected = selected;
      }
    }
    let centersOrdered = true;
    let previousCenter = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < visible.length; index++) {
      const group = visible[index];
      const bounds = boundsFor(group);
      const center = (bounds.top + bounds.bottom) / 2;
      centers[index] = center;
      if (center < previousCenter) {
        centersOrdered = false;
      }
      previousCenter = center;
      selected[index] = isSelected(group) ? 1 : 0;
    }
    const kept = scratch?.kept ?? [];
    const keptCenters = scratch?.keptCenters ?? [];
    kept.length = 0;
    keptCenters.length = 0;
    const keep = (index: number): void => {
      const center = centers[index];
      const crowded = keptCenters.some(
        (candidateCenter) => Math.abs(candidateCenter - center) < EVENT_VALUE_LABEL_SPACING,
      );
      if ((!crowded || selected[index] === 1) && kept.length < budget) {
        kept.push(index);
        keptCenters.push(center);
      }
    };
    if (centersOrdered) {
      // Event chains normally arrive in temporal order. Partitioning selected
      // groups before unselected groups preserves the stable sort order while
      // avoiding an O(n log n) index sort on the common path.
      for (let index = 0; index < visible.length; index++) {
        if (selected[index] === 1) {
          keep(index);
        }
      }
      for (let index = 0; index < visible.length; index++) {
        if (selected[index] === 0) {
          keep(index);
        }
      }
    } else {
      const ordered = scratch?.ordered ?? [];
      ordered.length = visible.length;
      for (let index = 0; index < visible.length; index += 1) {
        ordered[index] = index;
      }
      ordered.sort((left, right) => {
        const selectedOrder = selected[right] - selected[left];
        return selectedOrder || centers[left] - centers[right];
      });
      for (const index of ordered) {
        keep(index);
      }
    }
    let keptFlags = scratch?.keptFlags ?? new Uint8Array();
    if (keptFlags.length < visible.length) {
      keptFlags = new Uint8Array(visible.length);
      if (scratch) {
        scratch.keptFlags = keptFlags;
      }
    }
    keptFlags.fill(0, 0, visible.length);
    for (const index of kept) {
      keptFlags[index] = 1;
    }
    const result = scratch?.result ?? [];
    result.length = 0;
    for (let index = 0; index < visible.length; index += 1) {
      if (keptFlags[index] === 1) {
        result.push(visible[index]);
      }
    }
    return result;
  }
  if (visible.length <= budget) {
    return visible;
  }
  const selected = visible.filter(isSelected);
  const selectedStep = Math.max(1, Math.ceil(selected.length / budget));
  const selectedVisible = new Set(
    selected.filter((_, index) => index % selectedStep === 0).slice(0, budget),
  );
  const remaining = Math.max(0, budget - selectedVisible.size);
  if (remaining === 0) {
    return visible.filter((group) => selectedVisible.has(group));
  }
  const unselected = visible.filter((group) => !selectedVisible.has(group));
  const step = Math.max(1, Math.ceil(unselected.length / remaining));
  let unselectedIndex = 0;
  return visible.filter((group) => {
    if (selectedVisible.has(group)) {
      return true;
    }
    const include = unselectedIndex % step === 0;
    unselectedIndex++;
    return include;
  });
}

/** Choose the event value groups that fit in the field's label budget. */
export function labelGroups(
  groups: Iterable<EventChain<JudgeLineEvent> | undefined>,
  height: number,
  isSelected: (group: EventChain<JudgeLineEvent>) => boolean,
  boundsFor?: (group: EventChain<JudgeLineEvent>) => EventLabelBounds,
): EventChain<JudgeLineEvent>[] {
  return selectLabelGroups(uniqueGroups(groups), height, isSelected, boundsFor);
}

/** Select labels directly from visible event entries without a temporary group array. */
export function labelGroupsFromEntries(
  entries: readonly { readonly index: number }[],
  ranges: ReadonlyMap<number, EventGroup>,
  height: number,
  isSelected: (group: EventGroup) => boolean,
  boundsFor?: (group: EventGroup) => EventLabelBounds,
  scratch?: EventLabelScratch,
): EventGroup[] {
  const visible = scratch?.visible ?? [];
  const seen = scratch?.seen ?? new Set<EventGroup>();
  visible.length = 0;
  seen.clear();
  for (const entry of entries) {
    const group = ranges.get(entry.index);
    if (group !== undefined && !seen.has(group)) {
      seen.add(group);
      visible.push(group);
    }
  }
  return selectLabelGroups(visible, height, isSelected, boundsFor, scratch);
}

/** Curves stay off once the visible event count would make them dense. */
export function shouldDrawEventCurves(eventCount: number, height: number): boolean {
  const availableHeight = Math.max(1, height - 23);
  return eventCount <= Math.max(128, Math.floor(availableHeight * EVENT_CURVE_DENSITY));
}
