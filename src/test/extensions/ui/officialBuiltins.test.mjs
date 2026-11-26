/** Official built-in scripts keep note, event, and shortcut behavior aligned. */
import assert from "node:assert/strict";
import test from "node:test";
import official from "../../../assets/extensions/builtin.official/index.js";

/** Register the bundled scripts and return the captured definitions. */
function registeredScripts() {
  const definitions = [];
  official.activate({
    scripts: {
      register(definition) {
        definitions.push(definition);
        return () => {};
      },
    },
  });
  return definitions;
}

test("MirrorY mirrors selected notes and event endpoints and defaults to A", async () => {
  const mirror = registeredScripts().find((definition) => definition.id === "MirrorY");
  assert.ok(mirror);
  assert.deepEqual(mirror.defaultShortcuts, [{ key: "A" }]);

  let request;
  const events = new Map([["event-1", { id: "event-1", start: 20, end: -30 }]]);
  await mirror.run({
    api: {
      selection: {
        state: async () => ({
          ok: true,
          value: {
            notes: [{ id: "note-1", lineIndex: 0, index: 0 }],
            events: [{ id: "event-1", lineIndex: 0, eventType: "moveXEvents", layer: 0, index: 0 }],
          },
        }),
      },
      chart: {
        lines: async () => ({ ok: true, value: [{ notes: [{ id: "note-1", positionX: 125 }] }] }),
        event: async (id) => ({ ok: true, value: { event: events.get(id) } }),
      },
      transaction: {
        apply: async (next) => {
          request = next;
          return { ok: true, value: { status: "committed" } };
        },
      },
    },
    i18n: { t: (key) => key },
    ui: { notice() {} },
  });

  assert.deepEqual(request, {
    label: "history.MirrorY",
    notes: { update: [{ id: "note-1", patch: { positionX: -125 } }] },
    events: { update: [{ id: "event-1", patch: { start: -20, end: 30 } }] },
  });
});

test("MirrorY accepts an event-only selection", async () => {
  const mirror = registeredScripts().find((definition) => definition.id === "MirrorY");
  let request;
  await mirror.run({
    api: {
      selection: {
        state: async () => ({
          ok: true,
          value: {
            notes: [],
            events: [{ id: "event-1", lineIndex: 0, eventType: "moveYEvents", layer: 0, index: 0 }],
          },
        }),
      },
      chart: {
        lines: async () => {
          throw new Error("event-only selections must not read note lines");
        },
        event: async () => ({ ok: true, value: { event: { id: "event-1", start: 4, end: 8 } } }),
      },
      transaction: {
        apply: async (next) => {
          request = next;
          return { ok: true, value: { status: "committed" } };
        },
      },
    },
    i18n: { t: (key) => key },
    ui: { notice() {} },
  });

  assert.deepEqual(request, {
    label: "history.MirrorY",
    events: { update: [{ id: "event-1", patch: { start: -4, end: -8 } }] },
  });
});

test("ToHold preserves exact beat triples when calculating the hold end", async () => {
  const toHold = registeredScripts().find((definition) => definition.id === "ToHold");
  assert.ok(toHold);
  let request;
  await toHold.run({
    api: {
      selection: {
        state: async () => ({
          ok: true,
          value: { notes: [{ lineIndex: 0, index: 0 }], events: [] },
        }),
      },
      chart: {
        lines: async () => ({
          ok: true,
          value: [
            { notes: [{ id: "note-1", startTime: [2, 0, 1] }] },
            { notes: [] },
          ],
        }),
        beats: {
          addFraction: async (beat, numerator, denominator) => ({
            ok: true,
            value: [beat[0], numerator, denominator],
          }),
        },
      },
      transaction: {
        apply: async (next) => {
          request = next;
          return { ok: true, value: { status: "committed" } };
        },
      },
    },
    i18n: { t: (key) => key },
    ui: { notice() {} },
  });

  assert.deepEqual(request, {
    label: "history.ToHold",
    notes: {
      update: [{ id: "note-1", patch: { type: 2, endTime: [2, 1, 2] } }],
    },
  });
});
