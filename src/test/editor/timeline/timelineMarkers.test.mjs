/** Timeline marker normalization, chart round trips, identity, and edits stay pure. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  addTimelineMarker,
  createTimelineMarkerId,
  markerAudioRatio,
  markerAudioSeconds,
  normalizeMarkerColor,
  normalizeTimelineMarkers,
  readTimelineMarkers,
  removeTimelineMarker,
  updateTimelineMarker,
  writeTimelineMarkers,
} from "../../../core/global/chart/timelineMarkers.ts";

/** Strip generated ids so a test can compare the stored marker fields alone. */
function withoutIds(markers) {
  return markers.map(({ id: _id, ...marker }) => marker);
}

/** Assert every marker has a non-empty, collection-unique id. */
function assertUniqueIds(markers) {
  const ids = markers.map((marker) => marker.id);
  for (const id of ids) {
    assert.equal(typeof id, "string");
    assert.notEqual(id, "");
  }
  assert.equal(new Set(ids).size, markers.length);
}

test("marker colours keep one lowercase #rrggbb form", () => {
  assert.equal(normalizeMarkerColor("#AABBCC"), "#aabbcc");
  assert.equal(normalizeMarkerColor("#a1B2c3"), "#a1b2c3");
  for (const value of ["", "#abc", "#gggggg", "red", "aabbcc", "#aabb cc", 0, null, {}, []]) {
    assert.equal(normalizeMarkerColor(value), undefined);
  }
});

test("normalization drops unusable markers, trims names, and sorts by beat", () => {
  const markers = normalizeTimelineMarkers([
    { beat: 4, name: "  Second  ", note: "keep", color: "#AABBCC" },
    null,
    "marker",
    7,
    { beat: Number.NaN, name: "NaN" },
    { beat: Infinity, name: "infinite" },
    { beat: -1, name: "negative" },
    { beat: 1, name: "" },
    { beat: 1, name: "   " },
    { beat: 2, name: "First", color: "red", extra: 7 },
    { beat: 4, name: "Same time" },
  ]);
  assert.deepEqual(withoutIds(markers), [
    { beat: 2, name: "First", extra: 7 },
    { beat: 4, name: "Second", note: "keep", color: "#aabbcc" },
    { beat: 4, name: "Same time" },
  ]);
  assertUniqueIds(markers);
});

test("normalization keeps same-beat duplicates and gives each its own id", () => {
  const markers = normalizeTimelineMarkers([
    { beat: 2, name: "Drop" },
    { beat: 2, name: "Drop" },
  ]);
  assert.deepEqual(withoutIds(markers), [
    { beat: 2, name: "Drop" },
    { beat: 2, name: "Drop" },
  ]);
  assertUniqueIds(markers);
});

test("reading markers tolerates a missing or non-array root and keeps valid entries", () => {
  assert.deepEqual(readTimelineMarkers({}), []);
  assert.deepEqual(readTimelineMarkers({ markers: { beat: 1, name: "A" } }), []);
  assert.deepEqual(readTimelineMarkers({ markers: "A" }), []);
  const chart = {
    markers: [
      { beat: 2, name: "B" },
      { beat: -1, name: "bad" },
      { beat: 1, name: "A" },
    ],
  };
  const markers = readTimelineMarkers(chart);
  assert.deepEqual(withoutIds(markers), [
    { beat: 1, name: "A" },
    { beat: 2, name: "B" },
  ]);
  assertUniqueIds(markers);
  assert.deepEqual(readTimelineMarkers(chart), markers);
  assert.deepEqual(chart.markers, [
    { beat: 2, name: "B" },
    { beat: -1, name: "bad" },
    { beat: 1, name: "A" },
  ]);
});

test("legacy second markers upgrade through the supplied tempo", () => {
  const chart = { markers: [{ time: 2, name: "A" }] };
  // Without a tempo the stored seconds have no musical position and are dropped.
  assert.deepEqual(readTimelineMarkers(chart), []);
  const markers = readTimelineMarkers(chart, { beat: (seconds) => seconds * 2 });
  assert.deepEqual(withoutIds(markers), [{ beat: 4, name: "A" }]);
  // A stored beat wins over the legacy field, which is removed on read.
  const upgraded = readTimelineMarkers(
    { markers: [{ beat: 3, time: 99, name: "B" }] },
    { beat: () => 99 },
  );
  assert.deepEqual(withoutIds(upgraded), [{ beat: 3, name: "B" }]);
});

test("marker audio conversion applies the chart offset", () => {
  const duration = 10;
  // No offset: chart time is already audio time.
  assert.equal(markerAudioRatio(2, 0, duration), 0.2);
  assert.equal(markerAudioSeconds(2, 0, duration), 2);
  // +500 ms: the marker sits 0.5 s later on the audio scrubber.
  assert.equal(markerAudioRatio(2, 0.5, duration), 0.25);
  assert.equal(markerAudioSeconds(2, 0.5, duration), 2.5);
  // -500 ms: the marker sits 0.5 s earlier, and a position before the audio
  // start is clamped to the left edge.
  assert.equal(markerAudioRatio(2, -0.5, duration), 0.15);
  assert.equal(markerAudioSeconds(2, -0.5, duration), 1.5);
  assert.equal(markerAudioRatio(0.2, -0.5, duration), 0);
  assert.equal(markerAudioSeconds(0.2, -0.5, duration), 0);
});

test("marker audio conversion clamps to short and invalid durations", () => {
  // A marker past the audio end, including the offset, stops at the bar's end.
  assert.equal(markerAudioRatio(-1, 0, 10), 0);
  assert.equal(markerAudioRatio(20, 0, 10), 1);
  assert.equal(markerAudioSeconds(20, 0, 10), 10);
  // Short audio and a marker whose chart time is already past it.
  assert.equal(markerAudioRatio(1, 0.5, 0.5), 1);
  assert.equal(markerAudioSeconds(1, 0.5, 0.5), 0.5);
  assert.equal(markerAudioRatio(0, 0.5, 0.25), 1);
  // A missing or invalid duration has no drawable position.
  assert.equal(markerAudioRatio(0, 0.5, 0), 0);
  assert.equal(markerAudioRatio(0, 0.5, Number.NaN), 0);
  assert.equal(markerAudioSeconds(0, 0.5, 0), 0);
});

test("writing markers returns a new chart and leaves every other field alone", () => {
  const chart = {
    META: { name: "Song" },
    BPMList: [{ bpm: 120 }],
    judgeLineList: [{ notes: [] }],
    extraRoot: 1,
    markers: [{ beat: 5, name: "old" }],
  };
  const next = writeTimelineMarkers(chart, [
    { beat: 2, name: "  New  ", note: "x", color: "#ABCDEF" },
    { beat: -1, name: "bad" },
  ]);
  assert.notEqual(next, chart);
  assert.deepEqual(chart.markers, [{ beat: 5, name: "old" }]);
  assert.deepEqual(withoutIds(next.markers), [
    { beat: 2, name: "New", note: "x", color: "#abcdef" },
  ]);
  assertUniqueIds(next.markers);
  for (const key of ["META", "BPMList", "judgeLineList", "extraRoot"]) {
    assert.equal(next[key], chart[key]);
  }
});

test("adding a marker sorts it into place, drops an unnamed one, and keeps its id", () => {
  const base = normalizeTimelineMarkers([
    { beat: 1, name: "A" },
    { beat: 5, name: "C" },
  ]);
  const added = addTimelineMarker(base, { beat: 3, name: " B " });
  assert.deepEqual(withoutIds(added), [
    { beat: 1, name: "A" },
    { beat: 3, name: "B" },
    { beat: 5, name: "C" },
  ]);
  assertUniqueIds(added);

  const explicitId = createTimelineMarkerId();
  const explicit = addTimelineMarker(base, { id: explicitId, beat: 2, name: "New" });
  assert.equal(explicit.find((marker) => marker.id === explicitId)?.name, "New");

  assert.deepEqual(withoutIds(addTimelineMarker(base, { beat: 2, name: "   " })), [
    { beat: 1, name: "A" },
    { beat: 5, name: "C" },
  ]);
  assert.deepEqual(withoutIds(base), [
    { beat: 1, name: "A" },
    { beat: 5, name: "C" },
  ]);
});

test("updating a marker can rename, recolour, move, and clear its colour by id", () => {
  const base = normalizeTimelineMarkers([
    { beat: 1, name: "A", color: "#112233" },
    { beat: 2, name: "B" },
    { beat: 3, name: "C" },
  ]);
  const firstId = base[0].id;
  const secondId = base[1].id;
  const thirdId = base[2].id;

  const renamed = updateTimelineMarker(base, secondId, { name: " Beta " });
  assert.deepEqual(withoutIds(renamed), [
    { beat: 1, name: "A", color: "#112233" },
    { beat: 2, name: "Beta" },
    { beat: 3, name: "C" },
  ]);
  assert.equal(renamed[1].id, secondId);

  const recoloured = updateTimelineMarker(base, firstId, { color: "#AABBCC" });
  assert.deepEqual(recoloured[0], {
    id: firstId,
    beat: 1,
    name: "A",
    color: "#aabbcc",
  });

  assert.deepEqual(withoutIds(updateTimelineMarker(base, thirdId, { beat: 0 })), [
    { beat: 0, name: "C" },
    { beat: 1, name: "A", color: "#112233" },
    { beat: 2, name: "B" },
  ]);

  assert.deepEqual(withoutIds(updateTimelineMarker(base, firstId, { color: undefined })), [
    { beat: 1, name: "A" },
    { beat: 2, name: "B" },
    { beat: 3, name: "C" },
  ]);
});

test("an unknown marker id returns the normalized list unchanged", () => {
  const raw = [
    { beat: 3, name: " C " },
    { beat: 1, name: "A" },
  ];
  const normalized = normalizeTimelineMarkers(raw);
  assert.deepEqual(updateTimelineMarker(raw, "missing", { name: "nope" }), normalized);
  assert.deepEqual(removeTimelineMarker(raw, "missing"), normalized);
});

test("removing a marker uses the id and leaves an unknown id alone", () => {
  const base = normalizeTimelineMarkers([
    { beat: 3, name: "C" },
    { beat: 1, name: "A" },
    { beat: 2, name: "B" },
  ]);
  assert.deepEqual(withoutIds(removeTimelineMarker(base, base[1].id)), [
    { beat: 1, name: "A" },
    { beat: 3, name: "C" },
  ]);
  assert.deepEqual(removeTimelineMarker(base, "missing"), base);
});

test("same-beat same-name markers keep independent ids for edit and delete", () => {
  const chart = {
    markers: [
      { beat: 2, name: "Drop", color: "#111111" },
      { beat: 2, name: "Drop", color: "#222222" },
    ],
  };
  const markers = readTimelineMarkers(chart);
  assertUniqueIds(markers);
  const [first, second] = markers;

  const renamed = updateTimelineMarker(markers, first.id, { name: "First" });
  assert.equal(renamed.find((marker) => marker.id === first.id)?.name, "First");
  assert.equal(renamed.find((marker) => marker.id === second.id)?.name, "Drop");
  assert.equal(renamed.find((marker) => marker.id === first.id)?.id, first.id);

  const removedSecond = removeTimelineMarker(markers, second.id);
  assert.deepEqual(
    removedSecond.map((marker) => marker.id),
    [first.id],
  );
  const removedFirst = removeTimelineMarker(markers, first.id);
  assert.deepEqual(
    removedFirst.map((marker) => marker.id),
    [second.id],
  );
});

test("stored marker ids survive a round trip and duplicate ids are repaired", () => {
  const chart = {
    markers: [
      { id: "marker-a", beat: 1, name: "A" },
      { id: "marker-a", beat: 2, name: "B" },
    ],
  };
  const markers = readTimelineMarkers(chart);
  assert.equal(markers[0].id, "marker-a");
  assert.notEqual(markers[1].id, "marker-a");
  assertUniqueIds(markers);

  const written = writeTimelineMarkers(chart, markers);
  assert.deepEqual(readTimelineMarkers(written), markers);
});

test("a legacy chart without ids reads, edits, and writes back with stable ids", () => {
  const chart = {
    META: { name: "Legacy" },
    markers: [
      { beat: 1, name: "A", color: "#AABBCC" },
      { beat: 1, name: "A" },
      { beat: 2, name: "B" },
    ],
  };
  const first = readTimelineMarkers(chart);
  const second = readTimelineMarkers(chart);
  assert.deepEqual(first, second);
  assertUniqueIds(first);
  // Reading does not inject ids into the chart object it was given.
  assert.equal(
    chart.markers.some((marker) => "id" in marker),
    false,
  );

  const edited = updateTimelineMarker(first, first[1].id, { name: "A2" });
  const written = writeTimelineMarkers(chart, edited);
  const reread = readTimelineMarkers(written);
  assert.deepEqual(reread, written.markers);
  assertUniqueIds(reread);
  assert.equal(reread.length, 3);
  assert.equal(reread.find((marker) => marker.id === first[1].id)?.name, "A2");
  assert.deepEqual(
    reread.map((marker) => marker.name),
    ["A", "A2", "B"],
  );
});

test("every marker operation accepts an empty collection", () => {
  assert.deepEqual(normalizeTimelineMarkers([]), []);
  assert.deepEqual(readTimelineMarkers({ markers: [] }), []);
  assert.deepEqual(writeTimelineMarkers({}, []), { markers: [] });
  assert.deepEqual(withoutIds(addTimelineMarker([], { beat: 0, name: "Zero" })), [
    { beat: 0, name: "Zero" },
  ]);
  assert.deepEqual(updateTimelineMarker([], "missing", { name: "nope" }), []);
  assert.deepEqual(removeTimelineMarker([], "missing"), []);
});
