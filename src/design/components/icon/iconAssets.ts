/**
 * Published icon-name catalog for the design system, including the alias names
 * the icon registry resolves. Paths are package-relative artwork names; the
 * active theme package and `Icon.tsx` decide the final URL.
 */
import { LEGACY_ICON_ALIASES } from "../../../core/platform/browser/iconOverrides.ts";

/**
 * The glyph names the design system publishes.
 *
 * The paths are package-relative: the artwork lives directly in
 * `src/assets/themes/<theme>/icons/`, and this map is the name catalog the icon
 * registry, the preview sheet and the export script all read. It is not a URL
 * source — the active package decides which file a name resolves to.
 *
 * Paths are stable identifiers, not descriptions: `keyboard.png` holds a
 * keyboard glyph, and a future meaning change gets a new file rather than
 * repurposing a path another package may still ship.
 */
export const ICON_ASSETS = {
  chevronLeft: "icons/chevron_left.png",
  clapperboard: "icons/clapperboard.png",
  layout: "icons/layout.png",
  panelRight: "icons/panel_right.png",
  new: "icons/add.png",
  open: "icons/folder_open.png",
  save: "icons/save.png",
  saveAs: "icons/save_as.png",
  export: "icons/export.png",
  mirror: "icons/flip_horizontal.png",
  close: "icons/close.png",
  home: "icons/home.png",
  language: "icons/translate.png",
  recover: "icons/history.png",
  settings: "icons/settings.png",
  help: "icons/help.png",
  playbackPlay: "icons/play.png",
  playbackPause: "icons/pause.png",
  previewPause: "icons/preview_pause.png",
  rewind: "icons/rewind.png",
  preview: "icons/monitor.png",
  jump: "icons/jump.png",
  copy: "icons/copy.png",
  cut: "icons/cut.png",
  paste: "icons/paste.png",
  trash: "icons/delete.png",
  select: "icons/pointer.png",
  magnet: "icons/anchor.png",
  aspect: "icons/ratio.png",
  rotate: "icons/rotate.png",
  lineAdd: "icons/plus.png",
  shield: "icons/shield.png",
  clipboard: "icons/document.png",
  info: "icons/info.png",
  folder: "icons/folder.png",
  image: "icons/add_picture.png",
  music: "icons/music.png",
  waves: "icons/waves.png",
  bezier: "icons/bezier.png",
  curve: "icons/pen.png",
  route: "icons/easing.png",
  users: "icons/multi.png",
  bpm: "icons/metronome.png",
  sliders: "icons/config.png",
  palette: "icons/palette.png",
  keyboard: "icons/keyboard.png",
  database: "icons/database.png",
  x: "icons/close.png",
  check: "icons/complete.png",
  chevronDown: "icons/chevron_down.png",
  chevronRight: "icons/enter.png",
  forward: "icons/forward.png",
  plus: "icons/plus.png",
  minus: "icons/minus.png",
  monitor: "icons/monitor.png",
  external: "icons/link.png",
  gauge: "icons/rate.png",
  volume: "icons/volume.png",
  rate: "icons/rate.png",
  pencil: "icons/pencil.png",
  pipette: "icons/pipette.png",
  more: "icons/ellipsis.png",
  eye: "icons/eye.png",
  eyeOff: "icons/eye_off.png",
  mute: "icons/mute.png",
  loop: "icons/repeat.png",
  list: "icons/menu.png",
  refresh: "icons/refresh.png",
  star: "icons/star.png",
  undo: "icons/undo.png",
  redo: "icons/redo.png",
  grid: "icons/grid.png",
  layers: "icons/layers.png",
  search: "icons/search.png",
  zoom: "icons/zoom.png",
  calendar: "icons/calendar.png",
  clock: "icons/clock.png",
  sun: "icons/sun.png",
  moon: "icons/moon.png",
  bot: "icons/bot.png",
  extension: "icons/extension.png",
  maximize: "icons/maximize.png",
  linePath: "icons/line_path.png",
  polylinePath: "icons/polyline_path.png",
  curvePath: "icons/curve_path.png",
  subdivide: "icons/subdivide.png",
  reverse: "icons/reverse.png",
  linesHorizontal: "icons/lines_horizontal.png",
  linesVertical: "icons/lines_vertical.png",
  headphones: "icons/headphones.png",
  windowMinimize: "icons/window_minimize.png",
  windowMaximize: "icons/window_maximize.png",
  windowRestore: "icons/window_restore.png",
  windowClose: "icons/window_close.png",
} as const;
export type IconName = keyof typeof ICON_ASSETS;
/** Every published icon name, in catalog order. */
export const ICON_NAMES = Object.keys(ICON_ASSETS) as IconName[];
export type LegacyIconName = keyof typeof LEGACY_ICON_ALIASES;
export type IconReference = IconName | LegacyIconName;
