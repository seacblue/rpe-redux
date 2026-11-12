/** Verifies the public time-aware hit-test contract and its read-only result envelope. */
import assert from "node:assert/strict";
import test from "node:test";
import { hitTest } from "../../../core/api/hitTest.ts";
import { connectHitTestApi } from "../../../core/edit/hitTest/api.ts";

const result = {
  kind: "note",
  objectId: "note-1",
  lineId: "line-2",
  lineIndex: 2,
  coordinateSpace: "chart-time",
  time: { seconds: 1.5, beat: [3, 0, 1] },
  noteType: 2,
  noteIndex: 0,
  startTime: [3, 0, 1],
  endTime: [3, 0, 1],
};
const eventResult = {
  kind: "event",
  objectId: "event-1",
  lineId: "line-2",
  lineIndex: 2,
  coordinateSpace: "chart-time",
  time: { seconds: 1.5, beat: [3, 0, 1] },
  eventLayer: 1,
  eventType: "moveXEvents",
  eventIndex: 0,
  eventValue: [1, 2],
  eventStart: [0, 1],
  eventEnd: [2, 3],
  easingType: 2,
  easingLeft: 0,
  easingRight: 1,
};

test("queryAt accepts either seconds or beat and freezes the returned temporal hits", () => {
  const requests = [];
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: (request) => {
      requests.push(request);
      return {
        chartFingerprint: "chart-a",
        generation: 7,
        totalHits: 2,
        truncated: false,
        ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
        hits: [result, eventResult],
      };
    },
  });
  try {
    const response = hitTest.queryAt({
      surface: "preview",
      time: { seconds: 1.5 },
      include: ["note"],
    });

    assert.equal(response.ok, true);
    assert.deepEqual(requests, [
      {
        surface: "preview",
        time: { seconds: 1.5 },
        include: ["note"],
      },
    ]);
    assert.deepEqual(response.value, {
      chartFingerprint: "chart-a",
      generation: 7,
      totalHits: 2,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [result, eventResult],
    });
    assert.equal(Object.isFrozen(response.value), true);
    assert.equal(Object.isFrozen(response.value.hits), true);
    assert.equal(Object.isFrozen(response.value.hits[0]), true);
    assert.equal(Object.isFrozen(response.value.hits[0].time), true);
    assert.equal(Object.isFrozen(response.value.hits[0].time.beat), true);
    assert.equal(Object.isFrozen(response.value.hits[1].eventValue), true);
    assert.equal(Object.isFrozen(response.value.hits[1].eventStart), true);
    assert.equal(Object.isFrozen(response.value.hits[1].eventEnd), true);
  } finally {
    disconnect();
  }
});

test("timeline queries require a line, event layer, and coordinate space", () => {
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: () => ({
      chartFingerprint: null,
      generation: 0,
      totalHits: 0,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [],
    }),
  });
  try {
    const response = hitTest.queryAt({
      surface: "timeline",
      time: { beat: [4, 0, 1] },
    });

    assert.deepEqual(response, {
      ok: false,
      error: { code: "invalid_request", message: "Invalid hit-test time request" },
    });
  } finally {
    disconnect();
  }
});

test("timeline accepts a stable line id instead of a positional line index", () => {
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: (request) => ({
      chartFingerprint: "chart-a",
      generation: 7,
      totalHits: 1,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [
        {
          ...result,
          lineId: request.lineId,
        },
      ],
    }),
  });
  try {
    const response = hitTest.queryAt({
      surface: "timeline",
      time: { beat: [4, 0, 1] },
      lineId: "line-2",
      eventLayer: 0,
      coordinateSpace: "chart-time",
      include: ["note"],
    });

    assert.equal(response.ok, true);
    assert.equal(response.value.hits[0].lineId, "line-2");
  } finally {
    disconnect();
  }
});

test("preview queries that include events require an explicit event layer", () => {
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: () => ({
      chartFingerprint: null,
      generation: 0,
      totalHits: 0,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [],
    }),
  });
  try {
    const response = hitTest.queryAt({
      surface: "preview",
      time: { seconds: 1 },
    });

    assert.deepEqual(response, {
      ok: false,
      error: { code: "invalid_request", message: "Invalid hit-test time request" },
    });
  } finally {
    disconnect();
  }
});

test("preview rejects invalid optional line, layer, and coordinate fields", () => {
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: () => ({
      chartFingerprint: null,
      generation: 0,
      totalHits: 0,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [],
    }),
  });
  try {
    for (const request of [
      { surface: "preview", time: { seconds: 1 }, lineIndex: 1.5, include: ["note"] },
      { surface: "preview", time: { seconds: 1 }, eventLayer: -1 },
      { surface: "preview", time: { seconds: 1 }, coordinateSpace: "invalid" },
      { surface: "preview", time: { seconds: 1 }, include: 1 },
    ]) {
      assert.deepEqual(hitTest.queryAt(request), {
        ok: false,
        error: { code: "invalid_request", message: "Invalid hit-test time request" },
      });
    }
  } finally {
    disconnect();
  }
});

test("preview rejects invalid temporal limits and event filters", () => {
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: () => ({
      chartFingerprint: null,
      generation: 0,
      totalHits: 0,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [],
    }),
  });
  try {
    for (const request of [
      { surface: "preview", time: { seconds: 1 }, limit: 0 },
      { surface: "preview", time: { seconds: 1 }, eventTypes: [] },
      { surface: "preview", time: { seconds: 1 }, eventTypes: ["unknownEvents"] },
    ]) {
      assert.deepEqual(hitTest.queryAt(request), {
        ok: false,
        error: { code: "invalid_request", message: "Invalid hit-test time request" },
      });
    }
  } finally {
    disconnect();
  }
});

test("a time request cannot specify both seconds and beat", () => {
  const disconnect = connectHitTestApi({
    pick: () => [],
    queryAt: () => ({
      chartFingerprint: null,
      generation: 0,
      totalHits: 0,
      truncated: false,
      ordering: "lineIndex,notes,judgeLine,eventTrack,eventIndex",
      hits: [],
    }),
  });
  try {
    const response = hitTest.queryAt({
      surface: "preview",
      time: { seconds: 1, beat: [2, 0, 1] },
    });

    assert.deepEqual(response, {
      ok: false,
      error: { code: "invalid_request", message: "Invalid hit-test time request" },
    });
  } finally {
    disconnect();
  }
});
