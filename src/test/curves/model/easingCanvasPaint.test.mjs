/**
 * Verifies the shared painter's alpha layering.
 *
 * A recording context captures the alpha of every stroke, so the fade outside
 * the frame and the full-weight segment inside it cannot silently collapse into
 * one plain stroke.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EASING_FRAME_ALPHA,
  EASING_GUIDE_ALPHA,
  EASING_OVERSHOOT_ALPHA,
  EASING_PLOT,
  EASING_REFERENCE_ALPHA,
  EASING_UNIT_ALPHA,
  drawEasingFrame,
  drawEasingUnitLines,
  strokeEasingPolyline,
} from "../../../design/components/easing/easingCanvas.ts";

/**
 * A context stub that records strokes and tracks clipping.
 *
 * Only the members the painter touches are implemented; anything else would hide
 * a call the test is supposed to see.
 */
function recordingSurface() {
  const strokes = [];
  const clips = [];
  let alpha = 1;
  let style = "";
  let width = 1;
  let clipDepth = 0;
  let pendingRect = null;
  let pathStart = null;
  /** The first point of the path being built, which is where a unit line sits. */
  const record = () =>
    strokes.push({
      alpha,
      style,
      width,
      clipped: clipDepth > 0,
      y: pathStart?.y ?? null,
    });
  const context = {
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value) {
      alpha = value;
    },
    get strokeStyle() {
      return style;
    },
    set strokeStyle(value) {
      style = value;
    },
    get lineWidth() {
      return width;
    },
    set lineWidth(value) {
      width = value;
    },
    lineJoin: "butt",
    lineCap: "butt",
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    setLineDash() {},
    beginPath() {
      pathStart = null;
    },
    moveTo(x, y) {
      pathStart = { x, y };
    },
    lineTo() {},
    rect(x, y, rectWidth, rectHeight) {
      pendingRect = { left: x, top: y, width: rectWidth, height: rectHeight };
    },
    clip() {
      clipDepth += 1;
      clips.push(pendingRect);
    },
    strokeRect: record,
    stroke: record,
  };
  return {
    surface: {
      context,
      plot: EASING_PLOT,
      palette: {
        curve: "#curve",
        guide: "#guide",
        leftBound: "#left-bound",
        rightBound: "#right-bound",
        handle: "#handle",
        handleHover: "#hover",
        handleActive: "#active",
        fontFamily: "sans-serif",
      },
    },
    strokes,
    clips,
  };
}

test("the frame is drawn once at its own alpha", () => {
  const { surface, strokes } = recordingSurface();
  drawEasingFrame(surface);

  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].alpha, EASING_FRAME_ALPHA);
  assert.equal(strokes[0].clipped, false, "the frame must not be clipped");
});

test("a curve fades outside the frame and keeps full weight inside", () => {
  const { surface, strokes } = recordingSurface();
  // Runs past both edges so the whole fade path is exercised.
  strokeEasingPolyline(
    surface,
    {
      points: [
        EASING_PLOT.left - 20,
        EASING_PLOT.top,
        (EASING_PLOT.left + EASING_PLOT.right) / 2,
        EASING_PLOT.bottom,
        EASING_PLOT.right + 20,
        EASING_PLOT.top,
      ],
      style: "curve",
    },
    2,
  );

  assert.equal(strokes.length, 2, "a curve is painted twice: faded, then clipped");
  assert.equal(strokes[0].alpha, EASING_OVERSHOOT_ALPHA, "the whole curve starts faded");
  assert.equal(strokes[0].clipped, false);
  assert.equal(strokes[1].alpha, 1, "the bounded segment is repainted at full weight");
  assert.equal(strokes[1].clipped, true, "the full-weight pass must stay inside the frame");
  assert.equal(strokes[0].style, "#curve");
  assert.equal(strokes[1].style, "#curve");
});

test("a curve keeps only the highlighted progress range at full weight", () => {
  const { surface, strokes, clips } = recordingSurface();
  strokeEasingPolyline(
    surface,
    {
      points: [EASING_PLOT.left, EASING_PLOT.top, EASING_PLOT.right, EASING_PLOT.bottom],
      style: "curve",
      highlight: { from: 0.25, to: 0.75 },
    },
    2,
  );

  assert.equal(strokes.length, 2, "a curve is painted dim, then at full weight");
  assert.equal(strokes[0].alpha, EASING_OVERSHOOT_ALPHA);
  assert.equal(strokes[1].alpha, 1);
  // Two clips that intersect: the frame and then the kept range.
  assert.equal(clips.length, 2, "the kept range must narrow the frame clip");
  const kept = clips[1];
  const width = EASING_PLOT.right - EASING_PLOT.left;
  assert.ok(
    Math.abs(kept.left - (EASING_PLOT.left + 0.25 * width)) < 1e-9,
    "the kept range must start at the low bound's progress",
  );
  assert.ok(
    Math.abs(kept.width - 0.5 * width) < 1e-9,
    "the kept range must span only the highlighted progress",
  );
  assert.ok(
    Math.abs(kept.top - EASING_PLOT.top) < 1e-9 &&
      Math.abs(kept.height - (EASING_PLOT.bottom - EASING_PLOT.top)) < 1e-9,
    "the cut must be vertical: full EASING_PLOT height, bounded on x",
  );
});

test("reversed bounds highlight the same span the animation plays", () => {
  const { surface, strokes, clips } = recordingSurface();
  strokeEasingPolyline(
    surface,
    {
      points: [EASING_PLOT.left, EASING_PLOT.top, EASING_PLOT.right, EASING_PLOT.bottom],
      style: "curve",
      highlight: { from: 0.85, to: 0.61 },
    },
    2,
  );

  assert.equal(strokes.length, 2, "reversed bounds still paint dim then full weight");
  assert.equal(clips.length, 2);
  const kept = clips[1];
  const width = EASING_PLOT.right - EASING_PLOT.left;
  assert.ok(
    Math.abs(kept.left - (EASING_PLOT.left + 0.61 * width)) < 1e-9,
    "a reversed range starts at its own low edge",
  );
  assert.ok(Math.abs(kept.width - 0.24 * width) < 1e-9, "a reversed range keeps the same span");
  assert.ok(Math.abs(kept.top - EASING_PLOT.top) < 1e-9, "a reversed range still cuts vertically");
});

test("a guide is dim everywhere and never repainted at full weight", () => {
  const { surface, strokes } = recordingSurface();
  strokeEasingPolyline(
    surface,
    {
      points: [EASING_PLOT.left, EASING_PLOT.top, EASING_PLOT.right, EASING_PLOT.bottom],
      style: "guide",
    },
    1.5,
  );

  assert.equal(strokes.length, 1, "layout geometry is one dim pass");
  assert.equal(strokes[0].alpha, EASING_GUIDE_ALPHA);
  assert.equal(strokes[0].style, "#guide");
});

test("the uncut reference curve is dimmer than a guide and never repainted", () => {
  const { surface, strokes } = recordingSurface();
  strokeEasingPolyline(
    surface,
    {
      points: [EASING_PLOT.left, EASING_PLOT.top, EASING_PLOT.right, EASING_PLOT.bottom],
      style: "reference",
    },
    1.5,
  );

  assert.equal(strokes.length, 1, "the reference is one dim pass");
  assert.equal(strokes[0].alpha, EASING_REFERENCE_ALPHA);
  assert.equal(strokes[0].style, "#guide");
  assert.ok(
    EASING_REFERENCE_ALPHA < EASING_GUIDE_ALPHA,
    "the reference must recede behind the bounds that read it",
  );
  assert.ok(
    EASING_REFERENCE_ALPHA < EASING_OVERSHOOT_ALPHA,
    "the reference must be the lightest curve, not just a faded one",
  );
});

test("the frame stays the faintest line the painter draws", () => {
  assert.ok(
    EASING_FRAME_ALPHA < EASING_REFERENCE_ALPHA,
    "the frame must be fainter than the reference curve",
  );
  assert.ok(
    EASING_FRAME_ALPHA < EASING_OVERSHOOT_ALPHA,
    "the frame must be fainter than even the faded curve",
  );
  assert.ok(EASING_FRAME_ALPHA < EASING_GUIDE_ALPHA, "the frame must be fainter than a guide");
});

test("a limit line only appears for the side that overshoots", () => {
  const window = { minimum: -1.4, maximum: 1.6 };
  const yOf = (value) =>
    EASING_PLOT.bottom -
    ((value - window.minimum) / (window.maximum - window.minimum)) *
      (EASING_PLOT.bottom - EASING_PLOT.top);

  // A draft inside ±1 draws nothing: the frame edges already are the limits.
  const inside = recordingSurface();
  drawEasingUnitLines(inside.surface, yOf, [0.4, 0.9]);
  assert.equal(inside.strokes.length, 0, "an in-range draft needs no limit line");

  // Only the negative side overshoots.
  const low = recordingSurface();
  drawEasingUnitLines(low.surface, yOf, [-1.25, 0.9]);
  assert.equal(low.strokes.length, 1, "only y = -1 is marked");
  assert.ok(Math.abs(low.strokes[0].y - yOf(-1)) < 1e-9, "the line sits at y = -1");

  // Only the positive side overshoots.
  const high = recordingSurface();
  drawEasingUnitLines(high.surface, yOf, [0.2, 1.4]);
  assert.equal(high.strokes.length, 1, "only y = +1 is marked");
  assert.ok(Math.abs(high.strokes[0].y - yOf(1)) < 1e-9, "the line sits at y = +1");

  // Both sides overshoot, so both lines appear: +1 is painted first and sits
  // above -1.
  const both = recordingSurface();
  drawEasingUnitLines(both.surface, yOf, [-1.4, 1.6]);
  assert.equal(both.strokes.length, 2);
  assert.ok(both.strokes[0].y < both.strokes[1].y, "+1 is higher than -1");
  for (const stroke of both.strokes) {
    assert.equal(stroke.alpha, EASING_UNIT_ALPHA);
    assert.equal(stroke.style, "#guide");
  }
});

test("a limit line outside the frame is skipped", () => {
  const { surface, strokes } = recordingSurface();
  // The value map puts both lines above the plot.
  drawEasingUnitLines(surface, () => EASING_PLOT.top - 40, [-2, 2]);
  assert.equal(strokes.length, 0, "an off-frame limit line must not be painted");
});

test("each easing bound has its own theme ink", async () => {
  const [tokens, dark, light] = await Promise.all([
    readFile(new URL("../../../core/theme/colorTokens.ts", import.meta.url), "utf8"),
    readFile(new URL("../../../assets/themes/dark/package.json", import.meta.url), "utf8"),
    readFile(new URL("../../../assets/themes/light/package.json", import.meta.url), "utf8"),
  ]);

  for (const token of ["--canvas-easing-left-bound", "--canvas-easing-right-bound"]) {
    assert.match(tokens, new RegExp(`"${token}"`), `${token} must be an accepted theme token`);
    assert.match(
      dark,
      new RegExp(`"${token}"\\s*:\\s*"#[0-9a-f]{6}"`),
      `${token} needs a dark ink`,
    );
    assert.match(
      light,
      new RegExp(`"${token}"\\s*:\\s*"#[0-9a-f]{6}"`),
      `${token} needs a light ink`,
    );
  }

  // The two bounds are asked for as 236,236,176 and 160,236,74.
  const channel = (value) => Number.parseInt(value, 16);
  const darkLeft = /"--canvas-easing-left-bound":\s*"#([0-9a-f]{6})"/u.exec(dark)[1];
  const darkRight = /"--canvas-easing-right-bound":\s*"#([0-9a-f]{6})"/u.exec(dark)[1];
  for (const [name, hex, expected] of [
    ["left", darkLeft, [236, 236, 176]],
    ["right", darkRight, [160, 236, 74]],
  ]) {
    const actual = [0, 2, 4].map((offset) => channel(hex.slice(offset, offset + 2)));
    assert.deepEqual(actual, expected, `the ${name} bound must use its requested ink`);
  }
});
