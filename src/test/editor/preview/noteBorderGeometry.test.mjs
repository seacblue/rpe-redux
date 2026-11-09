/** Debug note-border polygons split Holds and pick the topmost border. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  noteBorderHit,
  noteBorderPolygons,
  pointInPolygon,
} from "../../../frontend/screens/editor/workspace/preview/debug/noteBorderGeometry.ts";

/** A preview object with only the fields the border geometry reads. */
function object(kind, head, tail, corners, width = 20, height = 20) {
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

/** A vertical Hold from (0, 0) to (0, length). */
function hold(length, width = 20) {
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
    ),
    id: `hold:${length}`,
  };
}

test("a note is one polygon copied from its painted corners", () => {
  const value = note();
  const polygons = noteBorderPolygons(value);
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].part, "note");
  assert.deepEqual(polygons[0].points, value.surface.corners);
});

test("a Hold is split into head, body, and tail rectangles", () => {
  const polygons = noteBorderPolygons(hold(100));
  assert.deepEqual(
    polygons.map((polygon) => polygon.part),
    ["hold-head", "hold-body", "hold-tail"],
  );
  const spans = polygons.map((polygon) => {
    const ys = polygon.points.map((point) => point.y);
    return Math.max(...ys) - Math.min(...ys);
  });
  assert.ok(spans[0] > 0 && spans[1] > 0 && spans[2] > 0);
  assert.equal(
    spans.reduce((sum, span) => sum + span, 0),
    100,
  );
});

test("a zero-length Hold keeps one head rectangle", () => {
  const polygons = noteBorderPolygons(hold(0));
  assert.equal(polygons.length, 1);
  assert.equal(polygons[0].part, "hold-head");
  assert.equal(polygons[0].points.length, 4);
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
  for (const y of [10, 50, 90]) {
    assert.equal(noteBorderHit([value], { x: 0, y })?.id, value.id);
  }
  assert.equal(noteBorderHit([value], { x: 100, y: 50 }), null);
});

test("the point-in-polygon test follows the rotated rectangle", () => {
  const value = note();
  assert.equal(pointInPolygon({ x: 0, y: 0 }, value.surface.corners), true);
  assert.equal(pointInPolygon({ x: 20, y: 0 }, value.surface.corners), false);
});
