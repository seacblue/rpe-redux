/** Debug note-border polygons follow rotation, Hold caps, and topmost picking. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  noteBorderHit,
  noteBorderPolygons,
  pointInPolygon,
} from "../../../frontend/screens/editor/workspace/preview/debug/noteBorderGeometry.ts";

/** A preview object with only the fields the border geometry reads. */
function object(kind, head, tail, corners, width = 20, height = 20, extra = {}) {
  return {
    id: `${kind}:${head.x}:${head.y}`,
    kind,
    lineIndex: 0,
    noteIndex: 0,
    surface: { center: head, head, tail, corners },
    client: { center: head, head, tail, corners },
    width,
    height,
    rotation: 0,
    radius: 0,
    ...extra,
  };
}

/** A square note centred on (0, 0). */
function note(id = "note", center = { x: 0, y: 0 }, size = 20) {
  const half = size / 2;
  const corners = [
    { x: center.x - half, y: center.y - half },
    { x: center.x + half, y: center.y - half },
    { x: center.x + half, y: center.y + half },
    { x: center.x - half, y: center.y + half },
  ];
  const value = object("note", center, center, corners, size, size);
  return { ...value, id };
}

/** A vertical Hold from (0, 0) to (0, length) with 4px caps by default. */
function hold(length, width = 20, extra = {}) {
  const half = width / 2;
  return {
    ...object(
      "hold",
      { x: 0, y: 0 },
      { x: 0, y: length },
      [
        { x: -half, y: 0 },
        { x: half, y: 0 },
        { x: half, y: length },
        { x: -half, y: length },
      ],
      width,
      length,
      { headLength: 4, tailLength: 4, showHead: true, ...extra },
    ),
    id: `hold:${length}`,
  };
}

/** Round away floating-point noise so range assertions stay readable. */
function round(value) {
  return Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e6) / 1e6;
}

/** The longitudinal range of one polygon along the Y axis. */
function yRange(points) {
  const ys = points.map((point) => round(point.y));
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

test("a note is one polygon copied from its painted corners", () => {
  const value = note();
  const polygons = noteBorderPolygons(value);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].part, "note");
  assert.deepEqual(polygons[0].points, value.surface.corners);
});

test("a Hold uses the painted cap heights outside its anchors", () => {
  const polygons = noteBorderPolygons(hold(100));
  assert.deepEqual(
    polygons.map((polygon) => polygon.part),
    ["hold-body", "hold-head", "hold-tail"],
  );
  assert.deepEqual(yRange(polygons[0].points), { min: 0, max: 100 });
  assert.deepEqual(yRange(polygons[1].points), { min: -4, max: 0 });
  assert.deepEqual(yRange(polygons[2].points), { min: 100, max: 104 });
});

test("a zero-length Hold uses its painted tail cap instead of a full square", () => {
  const polygons = noteBorderPolygons(hold(0, 20, { showHead: false }));
  assert.deepEqual(
    polygons.map((polygon) => polygon.part),
    ["hold-tail"],
  );
  // The above flag puts the tail cap above the anchor; the cap keeps the
  // painted height rather than expanding to the note width.
  assert.deepEqual(yRange(polygons[0].points), { min: -4, max: 0 });
  const xs = polygons[0].points.map((point) => point.x);
  assert.equal(Math.max(...xs) - Math.min(...xs), 20);
});

test("a future zero-length Hold keeps both painted cap borders", () => {
  const polygons = noteBorderPolygons(hold(0));
  assert.deepEqual(
    polygons.map((polygon) => polygon.part),
    ["hold-head", "hold-tail"],
  );
  assert.deepEqual(yRange(polygons[0].points), { min: 0, max: 4 });
  assert.deepEqual(yRange(polygons[1].points), { min: -4, max: 0 });
});

test("a hidden Hold head keeps only the body and tail borders", () => {
  const polygons = noteBorderPolygons(hold(100, 20, { showHead: false }));
  assert.deepEqual(
    polygons.map((polygon) => polygon.part),
    ["hold-body", "hold-tail"],
  );
  const zero = noteBorderPolygons(hold(0, 20, { showHead: false }));
  assert.deepEqual(
    zero.map((polygon) => polygon.part),
    ["hold-tail"],
  );
});

test("a rotated Hold extends its caps along the painted axis", () => {
  const value = {
    ...hold(100, 20, { headLength: 8, tailLength: 12 }),
    id: "horizontal",
    surface: {
      center: { x: 50, y: 0 },
      head: { x: 0, y: 0 },
      tail: { x: 100, y: 0 },
      corners: [],
    },
  };
  const polygons = noteBorderPolygons(value);
  const ranges = polygons.map((polygon) => {
    const xs = polygon.points.map((point) => point.x);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  });
  assert.deepEqual(ranges[0], { min: 0, max: 100 });
  assert.deepEqual(ranges[1], { min: -8, max: 0 });
  assert.deepEqual(ranges[2], { min: 100, max: 112 });
});

test("a zero-length tail follows the above flag and line rotation", () => {
  const above = noteBorderPolygons(
    hold(0, 20, { rotation: 0, headLength: 4, tailLength: 6, showHead: false }),
  );
  assert.deepEqual(
    above.map((polygon) => polygon.part),
    ["hold-tail"],
  );
  assert.deepEqual(yRange(above[0].points), { min: -6, max: 0 });
  const below = noteBorderPolygons(
    hold(0, 20, {
      rotation: 0,
      headLength: 4,
      tailLength: 6,
      showHead: false,
      debug: { above: 0 },
    }),
  );
  assert.deepEqual(yRange(below[0].points), { min: 0, max: 6 });
  const rotated = noteBorderPolygons(
    hold(0, 20, { rotation: 90, headLength: 4, tailLength: 6, showHead: false }),
  );
  const xs = rotated[0].points.map((point) => round(point.x));
  assert.deepEqual({ min: Math.min(...xs), max: Math.max(...xs) }, { min: 0, max: 6 });
});

test("border hits select the topmost note and ignore empty space", () => {
  const lower = note("lower");
  const upper = note("upper", { x: 2, y: 2 });
  assert.equal(noteBorderHit([lower, upper], { x: 0, y: 0 })?.id, "upper");
  assert.equal(noteBorderHit([lower, upper], { x: 100, y: 100 }), null);
  assert.equal(noteBorderHit([lower], { x: 10, y: 0 }, 2)?.id, "lower");
});

test("a Hold hit covers its head, body, and tail segments", () => {
  const value = hold(100);
  for (const y of [-2, 10, 50, 90, 102]) {
    assert.equal(noteBorderHit([value], { x: 0, y })?.id, value.id);
  }
  assert.equal(noteBorderHit([value], { x: 100, y: 50 }), null);
});

test("the point-in-polygon test follows the rotated rectangle", () => {
  const value = note();
  assert.equal(pointInPolygon({ x: 0, y: 0 }, value.surface.corners), true);
  assert.equal(pointInPolygon({ x: 20, y: 0 }, value.surface.corners), false);
});
