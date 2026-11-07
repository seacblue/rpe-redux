/**
 * AI editing permissions: first-enable seeding, guide filtering, and the
 * field-level transaction policy shared by Code Cells.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { filterAiGuide } from "../../../core/edit/codecell/aiGuide.ts";
import { aiTransactionIssues } from "../../../core/edit/aiEditingPolicy.ts";
import {
  AI_EDITING_INITIALIZED_KEY,
  aiEditingFeatureStates,
  seedAiEditingAccess,
} from "../../../core/settings/editingAiAccess.ts";
import {
  EDITING_FEATURE_AI_KEYS,
  EDITING_FEATURE_KEYS,
  EDITING_FEATURES,
} from "../../../core/settings/editingFeatureKeys.ts";
import {
  PREFERENCE_SECTIONS,
  readPreference,
  writePreference,
} from "../../../core/state/preferences.ts";

const S = PREFERENCE_SECTIONS.settings;

function settingsSection() {
  return readPreference(S, {});
}

function withSettings(settings, run) {
  const previous = settingsSection();
  writePreference(S, settings);
  try {
    return run();
  } finally {
    writePreference(S, previous);
  }
}

function allEnabled() {
  return Object.fromEntries(EDITING_FEATURES.map((feature) => [feature, true]));
}

test("the first code-cell enable copies human permissions and then stops following them", () => {
  withSettings(
    {
      "code-execution-enabled": true,
      [EDITING_FEATURE_KEYS.noteSpeed]: false,
      [EDITING_FEATURE_KEYS.fakeNotes]: true,
    },
    () => {
      assert.equal(seedAiEditingAccess(), true);
      const stored = settingsSection();
      assert.equal(stored[EDITING_FEATURE_AI_KEYS.noteSpeed], false);
      assert.equal(stored[EDITING_FEATURE_AI_KEYS.fakeNotes], true);
      assert.equal(stored[AI_EDITING_INITIALIZED_KEY], true);
      assert.equal(seedAiEditingAccess(), false);

      writePreference(S, {
        ...stored,
        [EDITING_FEATURE_KEYS.noteSpeed]: true,
      });
      assert.equal(seedAiEditingAccess(), false);
      assert.equal(aiEditingFeatureStates().noteSpeed, false);
    },
  );
});

test("the guide drops line and block passages for restricted features", () => {
  const guide = [
    "intro",
    "<!-- ai-block:noteSpeed -->",
    "speed block",
    "<!-- /ai-block:noteSpeed -->",
    "| speed | ... | <!-- ai-line:noteSpeed -->",
    "| size | ... | <!-- ai-line:noteSize -->",
    "<!-- ai-line:unknownFeature -->",
    "tail",
  ].join("\n");
  const states = allEnabled();
  states.noteSpeed = false;
  const filtered = filterAiGuide(guide, states);
  assert.equal(filtered, ["intro", "| size | ... |", "tail"].join("\n"));
});

test("the transaction policy blocks gated note, line, and event writes", () => {
  withSettings(
    {
      "code-execution-enabled": true,
      [EDITING_FEATURE_AI_KEYS.noteSpeed]: false,
      [EDITING_FEATURE_AI_KEYS.noteVisibleTime]: false,
      [EDITING_FEATURE_AI_KEYS.eventLayers]: false,
      [EDITING_FEATURE_AI_KEYS.extendedEvents]: false,
      [EDITING_FEATURE_AI_KEYS.lineBpmFactor]: false,
    },
    () => {
      const issues = aiTransactionIssues(
        {
          lines: {
            update: [{ id: "line-1", patch: { bpmfactor: 2, Name: "Allowed" } }],
          },
          notes: {
            insert: [
              {
                lineId: "line-1",
                note: {
                  type: 1,
                  startTime: [0, 0, 1],
                  endTime: [0, 0, 1],
                  positionX: 0,
                  speed: 2,
                  isFake: 1,
                },
              },
            ],
            update: [{ id: "note-1", patch: { visibleTime: 2 } }],
          },
          events: {
            insert: [
              {
                lineId: "line-1",
                eventType: "scaleXEvents",
                event: { startTime: [0, 0, 1], endTime: [0, 1, 1], start: 0, end: 1 },
              },
              {
                lineId: "line-1",
                eventType: "moveXEvents",
                layer: 2,
                event: { startTime: [0, 0, 1], endTime: [0, 1, 1], start: 0, end: 1 },
              },
            ],
          },
        },
        null,
      );
      const paths = issues.map((issue) => issue.path);
      assert.ok(paths.includes("lines.update[0].patch.bpmfactor"));
      assert.ok(paths.includes("notes.insert[0].note.speed"));
      assert.ok(paths.includes("notes.update[0].patch.visibleTime"));
      assert.ok(paths.includes("events.insert[0].eventType"));
      assert.ok(paths.includes("events.insert[1].layer"));
      assert.equal(
        paths.some((path) => path?.endsWith("isFake")),
        false,
      );
    },
  );
});

test("the transaction policy resolves an existing event's track by id", () => {
  withSettings(
    {
      "code-execution-enabled": true,
      [EDITING_FEATURE_AI_KEYS.eventLayers]: false,
      [EDITING_FEATURE_AI_KEYS.extendedEvents]: false,
    },
    () => {
      const chart = {
        judgeLineList: [
          {
            eventLayers: [{}, { moveXEvents: [{ id: "event-layer-1" }] }],
            extended: { scaleXEvents: [{ id: "event-extended" }] },
          },
        ],
      };
      const issues = aiTransactionIssues(
        {
          events: {
            update: [{ id: "event-layer-1", patch: { start: 10 } }],
            delete: ["event-extended"],
          },
        },
        chart,
      );
      assert.deepEqual(
        issues.map((issue) => issue.path),
        ["events.update[0].id", "events.delete[0]"],
      );
    },
  );
});
