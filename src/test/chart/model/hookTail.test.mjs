/**
 * A hook pins the rendered tail to the head and caches the tail it replaced.
 *
 * The cached tail is what an unhook restores, so the tests below cover the
 * toggle, the head edit that deliberately leaves the cache alone, and the export
 * round trip that strips the editor-only field and records it for reopening.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  createChart,
  createEvent,
  HOOK_TAIL_FIELD,
  pinHookedEvent,
  setEventHooked,
} from "../../../core/global/chart/chart.ts";
import {
  projectChartForExport,
  stripReduxExportVersion,
} from "../../../core/global/chart/exportProjection.ts";
import { EVENT_TRACKS, lineEventLayers } from "../../../core/global/chart/chart.ts";

/** An unhooked event carrying the authored pair used by every case. */
function authoredEvent() {
  return { ...createEvent(10, 20, 0, 4), id: "event:hook" };
}

/** Every event on a chart, so an export assertion can find the hooked one. */
function chartEvents(chart) {
  const events = [];
  for (const line of chart.judgeLineList ?? []) {
    for (const layer of lineEventLayers(line)) {
      for (const type of EVENT_TRACKS) {
        for (const event of layer[type] ?? []) {
          events.push({ type, event });
        }
      }
    }
  }
  return events;
}

test("hooking pins the pair and caches the tail it replaced", () => {
  const hooked = setEventHooked(authoredEvent(), true);

  assert.equal(hooked.inst, 1);
  assert.equal(hooked.end, 10);
  assert.equal(hooked[HOOK_TAIL_FIELD], 20);
});

test("unhooking restores the cached tail and drops the cache", () => {
  const restored = setEventHooked(setEventHooked(authoredEvent(), true), false);

  assert.equal(restored.inst, 0);
  assert.equal(restored.start, 10);
  assert.equal(restored.end, 20);
  assert.equal(HOOK_TAIL_FIELD in restored, false);
});

test("a head edit while hooked keeps the cached tail it will restore", () => {
  const hooked = setEventHooked(authoredEvent(), true);
  // The field editor writes the head into both anchors, exactly as it does for
  // an ordinary edit; the cache is not part of that transform.
  const edited = pinHookedEvent({ ...hooked, start: 15, end: 15 });

  assert.equal(edited.end, 15);
  assert.equal(edited[HOOK_TAIL_FIELD], 20);

  const restored = setEventHooked(edited, false);
  assert.equal(restored.start, 15);
  assert.equal(restored.end, 20, "the tail stays the value it had before the head moved");
});

test("an anchor event placed as a hook keeps the tail it stores", () => {
  // Placement writes `inst: 1` with a pinned pair and no cache: there was never
  // a replaced tail to restore.
  const anchor = { ...createEvent(7, 7, 2, 2), inst: 1 };
  const restored = setEventHooked(anchor, false);

  assert.equal(restored.inst, 0);
  assert.equal(restored.end, 7);
  assert.equal(HOOK_TAIL_FIELD in restored, false);
});

test("setting a flag that already matches returns the same object", () => {
  const event = authoredEvent();
  assert.equal(setEventHooked(event, false), event);

  const hooked = setEventHooked(event, true);
  assert.equal(setEventHooked(hooked, true), hooked);
});

test("hooking again replaces a stale cache with the current tail", () => {
  const event = { ...authoredEvent(), [HOOK_TAIL_FIELD]: 999 };
  const hooked = setEventHooked(event, true);

  assert.equal(hooked[HOOK_TAIL_FIELD], 20);
});

test("an unhooked event is left alone by the pin step", () => {
  const event = authoredEvent();
  assert.equal(pinHookedEvent(event), event);
});

test("export strips the cached tail and records it for reopening", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents[0] = setEventHooked(authoredEvent(), true);

  const projected = projectChartForExport(chart, "Hooked.pez");
  const exported = chartEvents(projected).find(({ event }) => event.id === "event:hook");
  assert.ok(exported, "the hooked event is exported");
  assert.equal(exported.event.end, 10, "the file carries the pinned pair");
  assert.equal(HOOK_TAIL_FIELD in exported.event, false, "the editor-only cache is not written");
  assert.deepEqual(projected.META.ReduxExportDefaults?.hookTails, { "event:hook": 20 });

  // The working chart is untouched by the projection.
  const live = chartEvents(chart).find(({ event }) => event.id === "event:hook");
  assert.equal(live.event[HOOK_TAIL_FIELD], 20);
});

test("a chart without hooks carries no hook-tail record", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents[0] = authoredEvent();

  const projected = projectChartForExport(chart, "Plain.pez");
  assert.equal(projected.META.ReduxExportDefaults?.hookTails, undefined);
});

test("reopening an exported chart restores the cached tail", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents[0] = setEventHooked(authoredEvent(), true);
  const projected = projectChartForExport(chart, "Hooked.pez");

  stripReduxExportVersion(projected);
  const reopened = chartEvents(projected).find(({ event }) => event.id === "event:hook");
  assert.ok(reopened, "the hooked event survives the round trip");
  assert.equal(reopened.event[HOOK_TAIL_FIELD], 20);
  assert.equal(reopened.event.end, 10);
  assert.equal(projected.META.ReduxExportDefaults, undefined);
});

test("a cached tail with no matching event id is dropped", () => {
  const chart = createChart();
  chart.judgeLineList[0].eventLayers[0].moveXEvents[0] = setEventHooked(authoredEvent(), true);
  const projected = projectChartForExport(chart, "Hooked.pez");
  projected.judgeLineList[0].eventLayers[0].moveXEvents = [];

  stripReduxExportVersion(projected);
  const remaining = chartEvents(projected);
  assert.equal(
    remaining.some(({ event }) => HOOK_TAIL_FIELD in event),
    false,
    "a cache without its event does not attach to another one",
  );
});
