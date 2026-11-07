/**
 * Simplified Chinese catalog for design-system labels: beat fields, pickers,
 * dialogs, and aria text.
 */
export default {
  "design.beatInput.hint": "整数、小数或 0:1/4",

  // The three boxes a beat is typed into. The separators between them are the
  // format's own `:` and `/`, so the labels only name the parts.
  "design.beat.whole": "整数",
  "design.beat.numerator": "分子",
  "design.beat.denominator": "分母",
  "design.beat.invalid": "仅限数字，分母大于 0",

  "design.numberInput.increase": "增加",
  "design.numberInput.decrease": "减少",

  "design.video.play": "播放",
  "design.video.pause": "暂停",
  "design.video.seek": "跳转",
  "design.video.silent": "无声",
  "design.video.unavailable": "无法加载此视频。",

  "design.audio.play": "播放",
  "design.audio.pause": "暂停",
  "design.audio.seek": "跳转",
  "design.audio.unavailable": "无法加载此音频。",

  "design.colorPicker.title": "选择颜色",
  "design.colorPicker.squareLabel": "饱和度和明度",
  "design.colorPicker.hueLabel": "色相",

  "design.colorPicker.squareValue": "饱和度 {saturation}%，明度 {brightness}%",

  "design.colorPicker.current": "当前颜色",

  "design.colorPicker.hexLabel": "HEX",
  "design.colorPicker.alphaLabel": "透明度",
  "design.colorPicker.alphaValue": "透明度百分比",

  "design.select.empty": "没有可选项",

  // The three easing boxes. Family names keep the chart format's own curve
  // vocabulary; they are translated here only so a translation may relabel them.
  "design.easing.id": "缓动编号",
  "design.easing.editor": "贝塞尔编辑器",
  "design.easing.control.x1": "x1",
  "design.easing.control.y1": "y1",
  "design.easing.control.x2": "x2",
  "design.easing.control.y2": "y2",
  "design.easing.family": "主类型",
  "design.easing.direction": "方向",
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
