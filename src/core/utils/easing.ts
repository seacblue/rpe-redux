/**
 * The easing curve table shared by chart events and trajectories.
 *
 * `easing` maps normalized progress through a numbered curve, `easingParameters`
 * exposes the adjustable range, and `bezier` evaluates control points.
 */
const halfPi = Math.PI / 2;
const back = 1.70158;
const backInOut = back * 1.525;
const elastic = (2 * Math.PI) / 3;
const elasticInOut = (2 * Math.PI) / 4.5;

/** Bounce-out easing used by the bounce curve family. */
function bounceOut(progress: number): number {
  if (progress < 1 / 2.75) {
    return 7.5625 * progress ** 2;
  }
  if (progress < 2 / 2.75) {
    return 7.5625 * (progress - 1.5 / 2.75) ** 2 + 0.75;
  }
  if (progress < 2.5 / 2.75) {
    return 7.5625 * (progress - 2.25 / 2.75) ** 2 + 0.9375;
  }
  return 7.5625 * (progress - 2.625 / 2.75) ** 2 + 0.984375;
}

/** Curve table indexed by easing type minus one; unknown types fall back to linear. */
const curves: Array<(progress: number) => number> = [
  (progress) => progress,
  (progress) => Math.sin(progress * halfPi),
  (progress) => 1 - Math.cos(progress * halfPi),
  (progress) => 1 - (1 - progress) ** 2,
  (progress) => progress ** 2,
  (progress) => (1 - Math.cos(Math.PI * progress)) / 2,
  (progress) => (progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2),
  (progress) => 1 - (1 - progress) ** 3,
  (progress) => progress ** 3,
  (progress) => 1 - (1 - progress) ** 4,
  (progress) => progress ** 4,
  (progress) => (progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2),
  (progress) => (progress < 0.5 ? 8 * progress ** 4 : 1 - (-2 * progress + 2) ** 4 / 2),
  (progress) => 1 - (1 - progress) ** 5,
  (progress) => progress ** 5,
  (progress) => (progress === 1 ? 1 : 1 - 2 ** (-10 * progress)),
  (progress) => (progress === 0 ? 0 : 2 ** (10 * progress - 10)),
  (progress) => Math.sqrt(1 - (progress - 1) ** 2),
  (progress) => 1 - Math.sqrt(Math.abs(1 - progress ** 2)),
  (progress) => 1 + (back + 1) * (progress - 1) ** 3 + back * (progress - 1) ** 2,
  (progress) => (back + 1) * progress ** 3 - back * progress ** 2,
  (progress) =>
    progress < 0.5
      ? (1 - Math.sqrt(1 - (2 * progress) ** 2)) / 2
      : (Math.sqrt(1 - (-2 * progress + 2) ** 2) + 1) / 2,
  (progress) =>
    progress < 0.5
      ? ((2 * progress) ** 2 * ((backInOut + 1) * 2 * progress - backInOut)) / 2
      : ((2 * progress - 2) ** 2 * ((backInOut + 1) * (2 * progress - 2) + backInOut) + 2) / 2,
  (progress) =>
    progress === 0 || progress === 1
      ? progress
      : 2 ** (-10 * progress) * Math.sin((progress * 10 - 0.75) * elastic) + 1,
  (progress) =>
    progress === 0 || progress === 1
      ? progress
      : -(2 ** (10 * progress - 10)) * Math.sin((progress * 10 - 10.75) * elastic),
  bounceOut,
  (progress) => 1 - bounceOut(1 - progress),
  (progress) =>
    progress < 0.5 ? (1 - bounceOut(1 - 2 * progress)) / 2 : (1 + bounceOut(2 * progress - 1)) / 2,
  (progress) =>
    progress === 0 || progress === 1
      ? progress
      : progress < 0.5
        ? -(2 ** (20 * progress - 10) * Math.sin((20 * progress - 11.125) * elasticInOut)) / 2
        : (2 ** (-20 * progress + 10) * Math.sin((20 * progress - 11.125) * elasticInOut)) / 2 + 1,
];

/** Closed-form integrals for the first 28 curves, in easing-type order. */
const integralCurves: Array<((progress: number) => number) | undefined> = [
  (x) => (x * x) / 2,
  (x) => (2 / Math.PI) * (1 - Math.cos((x * Math.PI) / 2)),
  (x) => x - (2 / Math.PI) * Math.sin((x * Math.PI) / 2),
  (x) => x * x - (x * x * x) / 3,
  (x) => (x * x * x) / 3,
  (x) => x / 2 - Math.sin(Math.PI * x) / (2 * Math.PI),
  (x) => (x < 0.5 ? (2 / 3) * x ** 3 : 2 * x * x - (2 / 3) * x ** 3 - x + 1 / 6),
  (x) => (3 / 2) * x * x - x ** 3 + x ** 4 / 4,
  (x) => x ** 4 / 4,
  (x) => 2 * x * x - 2 * x ** 3 + x ** 4 - x ** 5 / 5,
  (x) => x ** 5 / 5,
  (x) => (x < 0.5 ? x ** 4 : -3 * x + 6 * x * x - 4 * x ** 3 + x ** 4 + 0.5),
  (x) =>
    x < 0.5
      ? (8 / 5) * x ** 5
      : -7 * x + 16 * x * x - 16 * x ** 3 + 8 * x ** 4 - (8 / 5) * x ** 5 + 11 / 10,
  (x) => (5 / 2) * x * x - (10 / 3) * x ** 3 + (5 / 2) * x ** 4 - x ** 5 + x ** 6 / 6,
  (x) => x ** 6 / 6,
  (x) => x - (1 - 2 ** (-10 * x)) / (10 * Math.LN2),
  (x) => (2 ** (10 * x - 10) - 2 ** -10) / (10 * Math.LN2),
  (x) =>
    0.5 * ((x - 1) * Math.sqrt(Math.max(0, 1 - (x - 1) ** 2)) + Math.asin(x - 1)) + Math.PI / 4,
  (x) =>
    x - 0.5 * (x * Math.sqrt(Math.max(0, 1 - x * x)) + Math.asin(Math.max(-1, Math.min(1, x)))),
  (x) => {
    const a = 2.70158;
    const b = 1.70158;
    return (
      (1 - a + b) * x +
      ((3 * a - 2 * b) / 2) * x * x +
      ((-3 * a + b) / 3) * x ** 3 +
      (a / 4) * x ** 4
    );
  },
  (x) => (2.70158 / 4) * x ** 4 - (1.70158 / 3) * x ** 3,
  (x) =>
    x < 0.5
      ? 0.5 * x -
        0.25 * x * Math.sqrt(Math.max(0, 1 - 4 * x * x)) -
        0.125 * Math.asin(Math.max(-1, Math.min(1, 2 * x)))
      : 0.5 * x -
        0.25 * (1 - x) * Math.sqrt(Math.max(0, 1 - 4 * (1 - x) * (1 - x))) -
        0.125 * Math.asin(Math.max(-1, Math.min(1, 2 * (1 - x)))),
  (x) => {
    const s = 2.59491;
    x = Math.max(0, Math.min(1, x));
    if (x <= 0.5) {
      return (s + 1) * x ** 4 - (2 * s * x ** 3) / 3;
    }
    const half = (s + 1) * 0.5 ** 4 - (2 * s * 0.5 ** 3) / 3;
    const curve = (value: number) =>
      (s + 1) * value ** 4 -
      ((10 * s + 12) / 3) * value ** 3 +
      ((8 * s + 12) / 2) * value * value -
      (2 * s + 3) * value;
    return half + curve(x) - curve(0.5);
  },
  (x) => {
    x = Math.max(0, Math.min(1, x));
    const k = 10 * Math.LN2;
    const a = ((2 * Math.PI) / 3) * 10;
    const b = -0.75 * ((2 * Math.PI) / 3);
    const h = (value: number) =>
      (Math.exp(-k * value) * (-k * Math.sin(a * value + b) - a * Math.cos(a * value + b))) /
      (a * a + k * k);
    return x + h(x) - h(0);
  },
  (x) => {
    x = Math.max(0, Math.min(1, x));
    const k = 10 * Math.LN2;
    const a = ((2 * Math.PI) / 3) * 10;
    const b = -10.75 * ((2 * Math.PI) / 3);
    const c = 2 ** -10;
    const g = (value: number) =>
      (-c * Math.exp(k * value) * (k * Math.sin(a * value + b) - a * Math.cos(a * value + b))) /
      (a * a + k * k);
    return g(x) - g(0);
  },
  (x) => {
    x = Math.max(0, Math.min(1, x));
    const a = 7.5625;
    const b1 = 1 / 2.75;
    const b2 = 2 / 2.75;
    const b3 = 2.5 / 2.75;
    const c1 = 1.5 / 2.75;
    const c2 = 2.25 / 2.75;
    const c3 = 2.625 / 2.75;
    const i1 = (a * b1 ** 3) / 3;
    const i2 = i1 + (a / 3) * ((b2 - c1) ** 3 - (b1 - c1) ** 3) + 0.75 * (b2 - b1);
    const i3 = i2 + (a / 3) * ((b3 - c2) ** 3 - (b2 - c2) ** 3) + 0.9375 * (b3 - b2);
    if (x < b1) {
      return (a * x ** 3) / 3;
    }
    if (x < b2) {
      return i1 + (a / 3) * ((x - c1) ** 3 - (b1 - c1) ** 3) + 0.75 * (x - b1);
    }
    if (x < b3) {
      return i2 + (a / 3) * ((x - c2) ** 3 - (b2 - c2) ** 3) + 0.9375 * (x - b2);
    }
    return i3 + (a / 3) * ((x - c3) ** 3 - (b3 - c3) ** 3) + 0.984375 * (x - b3);
  },
  (x) => {
    x = Math.max(0, Math.min(1, x));
    const out = integralCurves[25]!;
    return x - (out(1) - out(1 - x));
  },
  (x) => {
    x = Math.max(0, Math.min(1, x));
    const out = integralCurves[25]!;
    const total = out(1);
    return x <= 0.5 ? x / 2 + (out(1 - 2 * x) - total) / 4 : x / 2 + (out(2 * x - 1) - total) / 4;
  },
];

/**
 * Return the curve value at both range endpoints as a base plus span.
 *
 * A zero span means the curve is flat over the selected range; callers must
 * treat the ratio as undefined rather than divide by it.
 */
export function easingParameters(type = 1, left = 0, right = 1): { base: number; range: number } {
  const curve = curves[type - 1] ?? curves[0];
  const base = curve(left);
  const range = curve(right) - base;
  return { base, range };
}

/** Map normalized progress through the selected curve and sub-range. */
export function easing(progress: number, type = 1, left = 0, right = 1): number {
  const amount = Number.isFinite(progress) ? progress : 0;
  const curve = curves[type - 1] ?? curves[0];
  const { base, range } = easingParameters(type, left, right);
  const width = right - left;
  // A flat sub-range has no normalized coordinate; linear progress is the only
  // finite, monotonic answer both the event tracks and the preview agree on.
  if (!Number.isFinite(range) || Math.abs(range) < 1e-15 || Math.abs(width) < 1e-15) {
    return amount;
  }
  const value = (curve(left + width * amount) - base) / range;
  return Number.isFinite(value) ? value : amount;
}

/**
 * Normalized integral of an easing curve over `[0, progress]`.
 *
 * Speed events use this to turn an eased speed into a floor-position delta.
 * The closed forms cover the first 28 curves; later types fall back to a
 * Simpson sample of the same normalized curve.
 */
export function easingIntegral(progress: number, type = 1, left = 0, right = 1): number {
  const index = type > 0 && type <= curves.length ? type - 1 : 0;
  const curve = curves[index];
  const base = curve(left);
  const end = curve(right);
  const span = end - base;
  const amount = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const scaled = left + (right - left) * amount;
  const width = right - left;
  if (!Number.isFinite(span) || Math.abs(span) < 1e-15 || Math.abs(width) < 1e-15) {
    return (amount * amount) / 2;
  }
  const closed = integralCurves[index];
  if (closed) {
    const value = (closed(scaled) - closed(left) - base * (scaled - left)) / (width * span);
    return Number.isFinite(value) ? value : (amount * amount) / 2;
  }
  const steps = 64;
  const step = amount / steps;
  let sum = 0;
  for (let sample = 0; sample <= steps; sample++) {
    sum +=
      (sample === 0 || sample === steps ? 1 : sample % 2 ? 4 : 2) *
      easing(sample * step, type, left, right);
  }
  const value = (sum * step) / 3;
  return Number.isFinite(value) ? value : (amount * amount) / 2;
}

/** Evaluate a curve when its endpoint normalization was already compiled. */
export function easingWithRange(
  progress: number,
  type: number,
  left: number,
  right: number,
  base: number,
  range: number,
): number {
  const amount = Number.isFinite(progress) ? progress : 0;
  const width = right - left;
  if (!Number.isFinite(range) || Math.abs(range) < 1e-15 || Math.abs(width) < 1e-15) {
    return amount;
  }
  const curve = curves[type - 1] ?? curves[0];
  const value = (curve(left + width * amount) - base) / range;
  return Number.isFinite(value) ? value : amount;
}

/** Evaluate a cubic bezier on the unit square; invalid control points act as linear. */
export function bezier(
  progress: number,
  points: ArrayLike<number> | null | undefined,
  offset = 0,
): number {
  const amount = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  if (!points || offset + 4 > points.length) {
    return amount;
  }
  if (amount === 0 || amount === 1) {
    return amount;
  }
  const firstX = points[offset];
  const firstY = points[offset + 1];
  const secondX = points[offset + 2];
  const secondY = points[offset + 3];
  if (
    !Number.isFinite(firstX) ||
    !Number.isFinite(firstY) ||
    !Number.isFinite(secondX) ||
    !Number.isFinite(secondY)
  ) {
    return amount;
  }
  /** Cubic interpolation of one axis at the resolved parameter. */
  const component = (parameter: number, first: number, second: number): number =>
    3 * parameter * (1 - parameter) ** 2 * first +
    3 * parameter ** 2 * (1 - parameter) * second +
    parameter ** 3;
  const c = 3 * firstX,
    b = 3 * secondX - 6 * firstX,
    a = 1 + 3 * firstX - 3 * secondX;
  const parameterAt = (parameter: number) => ((a * parameter + b) * parameter + c) * parameter;
  /**
   * Resolve x(t) = progress.
   *
   * Newton's derivative is zero at repeated control points such as `[1, 0, 0,
   * 0.5]`, so a zero derivative or a step outside the unit interval falls back
   * to bisection. Both methods return a finite parameter for any control point
   * set, which keeps event sampling deterministic instead of producing NaN.
   */
  const solve = (): number => {
    let parameter = 0.5;
    for (let index = 0; index < 100; index++) {
      const residual = parameterAt(parameter) - amount;
      if (Math.abs(residual) < 1e-6) {
        return parameter;
      }
      const derivative = (3 * a * parameter + 2 * b) * parameter + c;
      if (!Number.isFinite(derivative) || Math.abs(derivative) < 1e-9) {
        break;
      }
      const next = parameter - residual / derivative;
      if (!Number.isFinite(next) || next < 0 || next > 1) {
        break;
      }
      parameter = next;
    }
    let low = 0;
    let high = 1;
    for (let index = 0; index < 64; index++) {
      const middle = (low + high) / 2;
      if (parameterAt(middle) < amount) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return (low + high) / 2;
  };
  const parameter = solve();
  const value = component(parameter, firstY, secondY);
  return Number.isFinite(value) ? value : amount;
}
