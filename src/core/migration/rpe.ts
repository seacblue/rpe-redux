/**
 * Reads a native RPE installation into migration writes.
 *
 * The mapping is deliberately conservative: only settings with a clear RPE
 * counterpart are written, and only hotkeys whose command already exists in
 * this editor are rebound. Unknown RPE actions are left alone rather than
 * guessed, so a migration never changes a key into an unrelated command. The
 * settings side lives in `rpeSettings.ts`; source fields without a counterpart
 * are reported through `RpeMigrationPlan.unmapped` so the review can show
 * everything the file carries instead of dropping fields silently.
 */
import {
  appearanceWrites,
  parseSettings,
  readDivisionColors,
  unmappedSettings,
} from "./rpeSettings.ts";
import type { RpeSettingWrite, RpeUnmappedField } from "./rpeSettings.ts";
import { canonicalText, normalizeShortcutKey, parseShortcut } from "../shortcuts/keys.ts";
import type { Modifier, Shortcut } from "../shortcuts/types.ts";
import { isRecord } from "../utils/guards.ts";

export type { RpeSettingWrite, RpeUnmappedField } from "./rpeSettings.ts";

/** One existing shortcut and the bindings imported from RPE. */
export interface RpeShortcutWrite {
  readonly id: string;
  readonly bindings: readonly string[];
}

/** One RPE hotkey line, kept whether or not this editor has a matching command. */
export interface RpeHotkeyEntry {
  /** The RPE action name, as written in `Hotkey.txt`. */
  readonly action: string;
  /** The binding text, normalized when it parsed. */
  readonly binding: string;
  /** The command this binding was applied to; absent when RPE's action is unknown. */
  readonly target?: string;
  /** Why the line was not applied; absent when it was. */
  readonly reason?: "unknown-action" | "invalid-binding";
}

/** The parsed RPE hotkeys: applied bindings and every line that was not applied. */
export interface RpeHotkeyReport {
  readonly entries: readonly RpeHotkeyEntry[];
}

/** Parsed settings and hotkeys, before anything has been applied. */
export interface RpeMigrationPlan {
  readonly settings: readonly RpeSettingWrite[];
  readonly shortcuts: readonly RpeShortcutWrite[];
  readonly hotkeys: RpeHotkeyReport;
  readonly language: "en" | "zh" | null;
  /** Detected editor settings this build cannot carry; shown by the review. */
  readonly unmapped: readonly RpeUnmappedField[];
  readonly warnings: readonly string[];
}

/** One chart folder discovered under an RPE Resources directory. */
export interface RpeChartFolder {
  readonly path: string;
  readonly folder: string;
  readonly name: string;
  readonly group: string;
  readonly song?: string;
  readonly picture?: string;
  readonly chart?: string;
  /** Composer from the chart's Info.txt. */
  readonly composer?: string;
  /** Charter from the chart's Info.txt. */
  readonly charter?: string;
  readonly lastEdit?: string;
  readonly autosaves: number;
}

/** The folder scan returned by the local service or the desktop host. */
export interface RpeFolderScan {
  readonly root: string;
  /** True when the root carries PhiEdit.exe and a Resources folder. */
  readonly installation?: boolean;
  /** Which native editor produced the scan; the review dialog names it. */
  readonly source?: "rpe" | "phiediter";
  readonly settingsText: string | null;
  readonly hotkeysText: string | null;
  /** Editor appearance sidecar (`UI.txt`) when the installation writes one. */
  readonly uiText?: string | null;
  /** Beat-line palette (`division_color.txt`) when RPE writes one. */
  readonly divisionColorText?: string | null;
  readonly charts: readonly RpeChartFolder[];
  readonly warnings: readonly string[];
}

/** The items a user kept checked in the import review. */
export interface RpeImportSelection {
  /** Setting keys whose parsed values should overwrite the current ones. */
  readonly settingKeys: readonly string[];
  /** Apply the parsed Hotkey.txt bindings. */
  readonly applyShortcuts: boolean;
  /** Apply the language named by Settings.json. */
  readonly applyLanguage: boolean;
  /** Chart folders to import, keyed by `RpeChartFolder.path`. */
  readonly chartPaths: readonly string[];
}

/** One RPE `Hotkey.txt` line longer than this is treated as malformed. */
const MAX_HOTKEY_LINE = 512;
/** Only the head of an oversized file is read; the rest cannot be a valid map. */
const MAX_HOTKEY_TEXT = 256 * 1024;
/** One migration cannot reasonably map more actions; the report stays usable. */
const MAX_HOTKEY_ENTRIES = 2000;

/** RPE hotkey actions whose meaning has a direct command in this editor. */
const HOTKEY_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  AddTap: "note.place.tap",
  AddDrag: "note.place.drag",
  AddFlick: "note.place.flick",
  AddHold: "note.place.hold",
  AddEvent: "event.place",
  Delete: "edit.delete",
  Copy: "edit.copy",
  Shear: "edit.cut",
  Paste: "edit.paste",
  KeepTimePaste: "edit.paste.keepTime",
  PasteMirror: "edit.paste.mirror",
  KeepTimePasteMirror: "edit.paste.keepTimeMirror",
  ClearClip: "edit.clipboard.clear",
  JumpClip: "edit.clipboard.jumpStart",
  SelectAll: "edit.selectAll",
  Undo: "edit.undo",
  Redo: "edit.redo",
  Save: "document.save",
  Pause: "playback.pause",
  StartView: "playback.start",
  EndView: "playback.stop",
  JumpView: "playback.stopStay",
  ReplayView: "playback.replay",
  StartView_HOLD: "view.previewAudition",
  JumpView_HOLD: "view.previewAuditionStay",
  LastBeat: "playback.step.previous",
  NextBeat: "playback.step.next",
  PageLeft: "selection.nudge.left",
  PageRight: "selection.nudge.right",
  PageUp: "selection.nudge.up",
  PageDown: "selection.nudge.down",
  ResetCamera: "view.resetCamera",
  ShowLineInfo: "view.showLineInfo",
  Switch: "navigation.line.next",
  SwitchLine: "navigation.line.jump",
  TimeAttach: "timeline.toggleSnapX",
  SwitchMulti: "workspace.multiLine.toggle",
  SwitchMultiMode: "workspace.multiLine.switchMode",
  CurveBegin: "event.trajectory.capture.begin",
  CurveEnd: "event.trajectory.capture.end",
  SwitchUI: "view.toggleNotesEvents",
});

/** RPE's sided modifier names, mapped to this editor's portable tokens. */
const MODIFIERS: Readonly<Record<string, Modifier>> = Object.freeze({
  CTRL: "CTRL",
  LEFTCTRL: "CTRL",
  RIGHTCTRL: "CTRL",
  ALT: "ALT",
  LEFTALT: "ALT",
  RIGHTALT: "ALT",
  SHIFT: "SHIFT",
  LEFTSHIFT: "SHIFT",
  RIGHTSHIFT: "SHIFT",
  META: "META",
  SUPER: "META",
  LEFTSUPER: "META",
  RIGHTSUPER: "META",
});

/** True for an object accepted by the RPE settings reader. */
function settingsObject(text: string | null | undefined): Record<string, unknown> {
  if (!text?.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Parse one RPE binding such as `LEFTCTRL&LEFTSHIFT&V` into this editor's text. */
function parseBinding(text: string): string | null {
  const trimmed = text.trim();
  // RPE's prefix keys are a lone modifier (`SwitchLine LEFTCTRL`). Only the
  // exact token counts: `LEFTCTRL&` is an incomplete chord, not a prefix.
  const bareModifier = trimmed.includes("&") ? undefined : MODIFIERS[trimmed.toUpperCase()];
  if (bareModifier) {
    const bare = canonicalText({ key: bareModifier });
    return parseShortcut(bare).ok ? bare : null;
  }
  const tokens = trimmed
    .split("&")
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) {
    return null;
  }
  const modifiers: Modifier[] = [];
  let key: string | null = null;
  for (const token of tokens) {
    const modifier = MODIFIERS[token.toUpperCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) {
        modifiers.push(modifier);
      }
      continue;
    }
    if (key !== null) {
      return null;
    }
    key = normalizeShortcutKey(token);
  }
  if (!key) {
    return null;
  }
  const shortcut: Shortcut = modifiers.length ? { key, modifiers } : { key };
  const canonical = canonicalText(shortcut);
  return parseShortcut(canonical).ok ? canonical : null;
}

/**
 * Read RPE `Hotkey.txt` into one entry per line.
 *
 * The report keeps unknown actions and unparseable bindings: a user migrating a
 * familiar keymap needs to know which keys RPE had that this editor does not,
 * not just a count of the ones that worked. Overlong lines are skipped so a
 * corrupted file cannot flood the shortcut page or the stored report.
 */
export function readRpeHotkeys(text: string | null | undefined): RpeHotkeyReport {
  const entries: RpeHotkeyEntry[] = [];
  const source = (text ?? "").replace(/^\uFEFF/, "");
  const bounded = source.length > MAX_HOTKEY_TEXT ? source.slice(0, MAX_HOTKEY_TEXT) : source;
  for (const rawLine of bounded.split(/\r?\n/)) {
    if (entries.length >= MAX_HOTKEY_ENTRIES) {
      break;
    }
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.length > MAX_HOTKEY_LINE) {
      continue;
    }
    const separator = line.search(/\s/);
    if (separator <= 0) {
      continue;
    }
    const action = line.slice(0, separator);
    const rawBinding = line.slice(separator + 1).trim();
    const target = HOTKEY_TARGETS[action];
    if (!target) {
      entries.push(
        Object.freeze({ action, binding: rawBinding, reason: "unknown-action" as const }),
      );
      continue;
    }
    const binding = parseBinding(rawBinding);
    if (!binding) {
      entries.push(
        Object.freeze({ action, binding: rawBinding, reason: "invalid-binding" as const }),
      );
      continue;
    }
    entries.push(Object.freeze({ action, binding, target }));
  }
  return Object.freeze({ entries: Object.freeze(entries) });
}

/**
 * Read RPE `Hotkey.txt` into writes for shortcuts that exist here.
 *
 * Multiple RPE actions may intentionally map to the same current command; the
 * unique binding list is preserved. Unknown actions are ignored here and
 * reported by `readRpeHotkeys`.
 */
export function parseRpeHotkeys(text: string | null | undefined): RpeShortcutWrite[] {
  const bindings = new Map<string, Set<string>>();
  for (const entry of readRpeHotkeys(text).entries) {
    if (!entry.target) {
      continue;
    }
    let list = bindings.get(entry.target);
    if (!list) {
      list = new Set();
      bindings.set(entry.target, list);
    }
    list.add(entry.binding);
  }
  return [...bindings].map(([id, values]) => Object.freeze({ id, bindings: [...values] }));
}

/** Read RPE's language file name into the editor's language code. */
function languageValue(value: unknown): "en" | "zh" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("zh")) {
    return "zh";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  return null;
}

/**
 * Convert the two RPE sidecars into a migration plan.
 *
 * The plan is pure: applying it is a separate step because settings and
 * shortcuts are registered by the mounted editor.
 */
export function createRpeMigrationPlan(
  settingsText: string | null | undefined,
  hotkeysText: string | null | undefined,
  uiText?: string | null,
  divisionColorText?: string | null,
): RpeMigrationPlan {
  const raw = settingsObject(settingsText);
  const division = readDivisionColors(divisionColorText);
  return Object.freeze({
    settings: Object.freeze([
      ...parseSettings(raw),
      ...appearanceWrites(raw, uiText, divisionColorText),
    ]),
    shortcuts: Object.freeze(parseRpeHotkeys(hotkeysText)),
    hotkeys: readRpeHotkeys(hotkeysText),
    language: languageValue(raw.Language),
    unmapped: Object.freeze([...unmappedSettings(raw), ...division.unmapped]),
    warnings: Object.freeze([]),
  });
}

/**
 * Keep only the parts of a parsed plan the user approved in the review.
 *
 * Chart selection stays with the caller because chart folders are scanned
 * separately from the plan. An empty shortcut or language choice clears the
 * corresponding write instead of leaving the parser's full list in place.
 */
export function filterRpeMigrationPlan(
  plan: RpeMigrationPlan,
  selection: Pick<RpeImportSelection, "settingKeys" | "applyShortcuts" | "applyLanguage">,
): RpeMigrationPlan {
  const settingKeys = new Set(selection.settingKeys);
  return Object.freeze({
    settings: Object.freeze(plan.settings.filter((setting) => settingKeys.has(setting.key))),
    shortcuts: Object.freeze(selection.applyShortcuts ? [...plan.shortcuts] : []),
    hotkeys: Object.freeze(
      selection.applyShortcuts
        ? { entries: Object.freeze([...plan.hotkeys.entries]) }
        : { entries: Object.freeze([]) },
    ),
    language: selection.applyLanguage ? plan.language : null,
    unmapped: plan.unmapped,
    warnings: plan.warnings,
  });
}
