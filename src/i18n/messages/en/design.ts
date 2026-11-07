/**
 * `src/design/` — the design system's own labels (aria text, pickers, dialogs).
 *
 * Only text the design layer *owns* lives here. A primitive that receives its
 * label as a prop (`IconButton.label`, the `children` of `Button`) is
 * translated by the caller, in the caller's namespace; translating it here
 * would move the string twice.
 */
export default {
  "design.beatInput.hint": "Integer, decimal or 0:1/4",

  // The three boxes a beat is typed into. The separators between them are the
  // format's own `:` and `/`, so the labels only name the parts.
  "design.beat.whole": "Whole",
  "design.beat.numerator": "Numerator",
  "design.beat.denominator": "Denominator",
  "design.beat.invalid": "Numbers only, denominator > 0",

  "design.numberInput.increase": "Increase",
  "design.numberInput.decrease": "Decrease",

  "design.video.play": "Play",
  "design.video.pause": "Pause",
  "design.video.seek": "Seek",
  "design.video.silent": "Silent",
  "design.video.unavailable": "This video could not be loaded.",

  "design.audio.play": "Play",
  "design.audio.pause": "Pause",
  "design.audio.seek": "Seek",
  "design.audio.unavailable": "This audio file could not be loaded.",

  "design.colorPicker.title": "Choose a color",
  "design.colorPicker.squareLabel": "Saturation and brightness",
  "design.colorPicker.hueLabel": "Hue",

  "design.colorPicker.squareValue": "Saturation {saturation}%, brightness {brightness}%",

  "design.colorPicker.current": "Current color",

  "design.colorPicker.hexLabel": "HEX",
  "design.colorPicker.alphaLabel": "Alpha",
  "design.colorPicker.alphaValue": "Alpha percentage",

  "design.select.empty": "Nothing to choose",

  // The three easing boxes. The family names are the chart format's own curve
  // vocabulary; they are translated here only so a translation may relabel them.
  "design.easing.id": "Easing id",
  "design.easing.editor": "Bezier editor",
  "design.easing.control.x1": "x1",
  "design.easing.control.y1": "y1",
  "design.easing.control.x2": "x2",
  "design.easing.control.y2": "y2",
  "design.easing.family": "Easing type",
  "design.easing.direction": "Direction",
  "design.easing.family.linear": "Linear",
  "design.easing.family.sine": "Sine",
  "design.easing.family.quad": "Quad",
  "design.easing.family.cubic": "Cubic",
  "design.easing.family.quart": "Quart",
  "design.easing.family.quint": "Quint",
  "design.easing.family.expo": "Expo",
  "design.easing.family.circ": "Circ",
  "design.easing.family.back": "Back",
  "design.easing.family.elastic": "Elastic",
  "design.easing.family.bounce": "Bounce",
  "design.easing.direction.in": "In",
  "design.easing.direction.out": "Out",
  "design.easing.direction.inOut": "IO",
} as const;
