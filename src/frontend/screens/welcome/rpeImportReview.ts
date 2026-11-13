/**
 * Display rows and selection state for the RPE import review.
 *
 * Classification answers what the folder contains; this module turns the
 * parsed plan into the rows a person can check. The selection is kept in one
 * store so the migration can await the dialog without owning a modal element.
 */
import { LANGUAGE_NAMES, t, tRaw } from "../../../i18n/index.ts";
import { createValue } from "../../../core/state/values.ts";
import type {
  RpeFolderScan,
  RpeImportSelection,
  RpeMigrationPlan,
} from "../../../core/migration/rpe.ts";

/** One settings row in the review list. */
export interface RpeReviewSetting {
  /** Stable row id: a setting key, `shortcuts`, or `language`. */
  readonly id: string;
  /** The source of the value, so submission can keep the kinds apart. */
  readonly kind: "setting" | "shortcuts" | "language";
  /** Localized field label. */
  readonly label: string;
  /** Human-readable value the import would write. */
  readonly value: string;
  /** CSS colour used for a colour-setting swatch. */
  readonly swatch?: string;
}

/** One chart row in the review list. */
export interface RpeReviewChart {
  /** Chart JSON path; also the selection id. */
  readonly path: string;
  /** Song title from Info.txt. */
  readonly title: string;
  /** Composer from Info.txt or a localized placeholder. */
  readonly composer: string;
  /** Charter from Info.txt or a localized placeholder. */
  readonly charter: string;
  /** Collection shown by the native editor. */
  readonly group: string;
}

/** One pending review. `settle` closes it and resolves the caller. */
export interface RpeImportReviewRequest {
  readonly id: number;
  readonly scan: RpeFolderScan;
  readonly settings: readonly RpeReviewSetting[];
  readonly charts: readonly RpeReviewChart[];
  settle(selection: RpeImportSelection | null): void;
}

let nextId = 0;

const review = createValue<RpeImportReviewRequest | null>({ initial: null });

/** The review currently waiting for an answer, if any. */
export const getRpeImportReview = review.get;
/** Subscribes to review changes. */
export const subscribeRpeImportReview = review.subscribe;

/**
 * Show the review for one scan and await its answer.
 *
 * A newer request settles the previous one as cancelled, so two imports cannot
 * share one dialog. A dismissal resolves null instead of an empty selection.
 */
export function requestRpeImportReview(
  scan: RpeFolderScan,
  plan: RpeMigrationPlan,
): Promise<RpeImportSelection | null> {
  const previous = review.get();
  if (previous) {
    previous.settle(null);
  }
  return new Promise((resolve) => {
    let settled = false;
    const id = ++nextId;
    const settle = (selection: RpeImportSelection | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (review.get()?.id === id) {
        review.set(null);
      }
      resolve(selection);
    };
    review.set({
      id,
      scan,
      settings: buildSettingRows(plan),
      charts: buildChartRows(scan),
      settle,
    });
  });
}

/** Answer the pending review; a null selection means the user cancelled. */
export function answerRpeImportReview(selection: RpeImportSelection | null): void {
  review.get()?.settle(selection);
}

/** Event-wheel channels in the order `scrollValueIncrement` stores them. */
const EVENT_WHEEL_CHANNELS = [
  "x",
  "y",
  "rotation",
  "opacity",
  "speed",
  "scaleX",
  "scaleY",
] as const;

/** Build the settings list from the plan the parser produced. */
export function buildSettingRows(plan: RpeMigrationPlan): readonly RpeReviewSetting[] {
  const rows: RpeReviewSetting[] = plan.settings.map((setting) => ({
    id: setting.key,
    kind: "setting" as const,
    label: settingLabel(setting.key),
    value: settingValueText(setting.key, setting.value),
    ...(isColorValue(setting.value) ? { swatch: setting.value } : {}),
  }));
  if (plan.shortcuts.length || plan.hotkeys.entries.length) {
    rows.push({
      id: "shortcuts",
      kind: "shortcuts",
      label: t("workspace.welcome.rpe.review.hotkeys"),
      value: t("workspace.welcome.rpe.review.hotkeysDetail", {
        applied: plan.shortcuts.length,
        total: plan.hotkeys.entries.length,
      }),
    });
  }
  if (plan.language) {
    rows.push({
      id: "language",
      kind: "language",
      label: t("workspace.welcome.rpe.review.language"),
      value: LANGUAGE_NAMES[plan.language],
    });
  }
  return Object.freeze(rows);
}

/** Build the chart list; each radio-style row keeps the song metadata visible. */
export function buildChartRows(scan: RpeFolderScan): readonly RpeReviewChart[] {
  return Object.freeze(
    scan.charts.map((chart) => ({
      path: chart.path,
      title: chart.name || chart.folder,
      composer: chart.composer?.trim() || t("workspace.welcome.rpe.review.unknown"),
      charter: chart.charter?.trim() || t("workspace.welcome.rpe.review.unknown"),
      group: chart.group || "RPE",
    })),
  );
}

/** Resolve the label a settings field publishes, falling back to its key. */
function settingLabel(key: string): string {
  const messageKey = `settings.field.${key}.label`;
  const label = tRaw(messageKey);
  if (label !== messageKey) {
    return label;
  }
  if (key === "event-wheel-increments") {
    return t("workspace.welcome.rpe.review.wheelIncrements");
  }
  // Hit-sound offsets register their label per kind instead of one field key.
  const offsetKind = /^hitsound-offset-(tap|drag|flick|custom)$/u.exec(key);
  if (offsetKind) {
    return tRaw(`settings.hitsound.offset.${offsetKind[1]}`);
  }
  return key
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Render the seven event-wheel increments as labelled lines.
 *
 * RPE's `scrollValueIncrement` is one array; the review names each channel so
 * the value is readable without knowing the array order.
 */
function eventWheelValue(text: string): string {
  let steps: unknown;
  try {
    steps = JSON.parse(text);
  } catch {
    return text;
  }
  if (!Array.isArray(steps)) {
    return text;
  }
  return EVENT_WHEEL_CHANNELS.map((channel, index) => {
    const label = tRaw(`workspace.welcome.rpe.review.wheel.${channel}`);
    const step = steps[index];
    return `${label} ${step === undefined ? "—" : String(step)}`;
  }).join("\n");
}

/** Render one setting value through the same labels the settings page uses. */

/** Render one setting value through the same labels the settings page uses. */
function settingValueText(key: string, value: string | boolean | number): string {
  if (typeof value === "boolean") {
    return t(
      value ? "workspace.welcome.rpe.review.toggleOn" : "workspace.welcome.rpe.review.toggleOff",
    );
  }
  const text = String(value);
  if (key === "event-wheel-increments") {
    return eventWheelValue(text);
  }
  if (key === "render-fps") {
    const optionKey = `settings.option.render-fps.${text}`;
    const option = tRaw(optionKey);
    return option === optionKey ? text : option;
  }
  return text;
}

/** True for the hex colours the migration stores in settings. */
function isColorValue(value: string | boolean): value is string {
  return typeof value === "string" && /^#[0-9a-f]{3,8}$/iu.test(value.trim());
}
