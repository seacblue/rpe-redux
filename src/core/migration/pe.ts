/**
 * Reads an old PhiEditer installation into migration writes.
 *
 * PhiEditer keeps its charts as PEC files, its media under `Resources`, and a
 * `Settings.txt` whose leading block holds editor preferences and whose `#`
 * blocks index every chart. This module owns the preference mapping and the
 * scan/plan types; chart conversion and library writes live in the welcome
 * importer.
 */
import type { RpeChartFolder, RpeMigrationPlan } from "./rpe.ts";
import type { RpeSettingWrite } from "./rpeSettings.ts";
import { HIT_SOUND_KINDS } from "../media/hitsounds.ts";

/** One chart row from a PhiEditer Settings.txt or a loose PEC file. */
export interface PeChart extends RpeChartFolder {
  /** Absolute path of the referenced song, when the scan resolved it. */
  readonly songPath?: string;
  /** Absolute path of the referenced cover, when the scan resolved it. */
  readonly picturePath?: string;
}

/** The folder scan returned by the local service. */
export interface PeFolderScan {
  readonly root: string;
  /** True when the root carries PhiEditer.exe and a Resources folder. */
  readonly installation: boolean;
  /** The original `Settings.txt` body, or null when the file is absent. */
  readonly settingsText: string | null;
  readonly charts: readonly PeChart[];
  readonly warnings: readonly string[];
}

/** The file name of one media reference, using either path separator. */
export function peMediaName(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const name = path.replaceAll("\\", "/").split("/").at(-1);
  return name || undefined;
}

/** The asset names one chart's song and cover are staged under. */
export interface PeChartMediaNames {
  readonly song?: string;
  readonly picture?: string;
}

/**
 * Resolve the asset names for a chart row.
 *
 * Settings.txt supplies the file name; a loose chart only has the absolute
 * `Resources` path the scan guessed, so both forms fall back to the basename.
 */
export function peChartMediaNames(
  chart: Pick<PeChart, "song" | "songPath" | "picture" | "picturePath">,
): PeChartMediaNames {
  const song = peMediaName(chart.song) ?? peMediaName(chart.songPath);
  const picture = peMediaName(chart.picture) ?? peMediaName(chart.picturePath);
  return { ...(song ? { song } : {}), ...(picture ? { picture } : {}) };
}

/** A finite numeric preference from PE's Settings.txt block. */
function numberValue(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Clamp a numeric preference and render it as the settings control stores it. */
function numberText(
  value: string | undefined,
  minimum: number,
  maximum: number,
  digits = 4,
): string | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) {
    return undefined;
  }
  const clamped = Math.min(maximum, Math.max(minimum, parsed));
  return String(Number(clamped.toFixed(digits)));
}

/** Clamp a whole-number preference. */
function integerText(
  value: string | undefined,
  minimum: number,
  maximum: number,
): string | undefined {
  const parsed = numberValue(value);
  if (parsed === undefined) {
    return undefined;
  }
  return String(Math.min(maximum, Math.max(minimum, Math.round(parsed))));
}

/** Parse the leading preference block of Settings.txt, before the first `#`. */ function pePreferences(
  settingsText: string | null | undefined,
): Map<string, string> {
  const preferences = new Map<string, string>();
  if (!settingsText?.trim()) {
    return preferences;
  }
  for (const raw of settingsText.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#")) {
      break;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) {
      preferences.set(key, value);
    }
  }
  return preferences;
}

/**
 * Convert PE's editor preferences into a migration plan.
 *
 * The plan reuses the RPE plan shape so the import review, filtering, and apply
 * steps stay identical; PE has no hotkey file, so that part stays empty.
 */
export function createPeMigrationPlan(settingsText: string | null | undefined): RpeMigrationPlan {
  const preferences = pePreferences(settingsText);
  const writes: RpeSettingWrite[] = [];
  /** Add a value only when the PE preference exists and maps cleanly. */
  const add = (key: string, value: string | boolean | undefined): void => {
    if (value !== undefined) {
      writes.push(Object.freeze({ key, value }));
    }
  };

  add("volume", numberText(preferences.get("BGMVolume"), 0, 1));
  const hitVolume = numberText(preferences.get("SEVolume"), 0, 1);
  for (const kind of HIT_SOUND_KINDS) {
    add(`hitsound-${kind}`, hitVolume);
  }
  add("scroll-speed", numberText(preferences.get("MouseScrollSpeed"), 0.1, 100));
  add("timeline-grid-count", integerText(preferences.get("AnchorLineAmount"), 1, 64));

  return Object.freeze({
    settings: Object.freeze(writes),
    shortcuts: Object.freeze([]),
    hotkeys: Object.freeze({ entries: Object.freeze([]) }),
    language: null,
    unmapped: Object.freeze([]),
    warnings: Object.freeze([]),
  });
}
