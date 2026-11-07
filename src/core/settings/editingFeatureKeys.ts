/**
 * Stable keys for the optional editing-feature switches.
 *
 * The settings schema and the inspector read the same map; keeping it beside the
 * feature schema prevents a renamed row from leaving a consumer reading an
 * undeclared value.
 */
export const EDITING_FEATURE_KEYS = Object.freeze({
  fakeNotes: "editing-fake-notes-enabled",
  bezier: "editing-bezier-enabled",
  extendedEvents: "editing-extended-events-enabled",
  parentLines: "editing-parent-lines-enabled",
  lineExtended: "editing-line-extended-enabled",
  linkgroup: "editing-linkgroup-enabled",
  easingRange: "editing-easing-range-enabled",
  eventLayers: "editing-event-layers-enabled",
  lineBpmFactor: "editing-line-bpmfactor-enabled",
  lineAnchor: "editing-line-anchor-enabled",
  noteSpeed: "editing-note-speed-enabled",
  noteSize: "editing-note-size-enabled",
  noteAlpha: "editing-note-alpha-enabled",
  noteYOffset: "editing-note-y-offset-enabled",
  noteVisibleTime: "editing-note-visible-time-enabled",
  noteColor: "editing-note-color-enabled",
  noteHitSound: "editing-note-hitsound-enabled",
} as const);

/** Names of the optional editing-feature switches. */
export type EditingFeature = keyof typeof EDITING_FEATURE_KEYS;

/**
 * Stable keys for the AI-side permission of each optional editing feature.
 *
 * Human permission stays in `EDITING_FEATURE_KEYS`; these values only gate
 * Code Cell writes. A key is declared but never rendered as its own
 * settings row: the human row draws both checkboxes.
 */
export const EDITING_FEATURE_AI_KEYS = Object.freeze({
  fakeNotes: "editing-fake-notes-ai-enabled",
  bezier: "editing-bezier-ai-enabled",
  extendedEvents: "editing-extended-events-ai-enabled",
  parentLines: "editing-parent-lines-ai-enabled",
  lineExtended: "editing-line-extended-ai-enabled",
  linkgroup: "editing-linkgroup-ai-enabled",
  easingRange: "editing-easing-range-ai-enabled",
  eventLayers: "editing-event-layers-ai-enabled",
  lineBpmFactor: "editing-line-bpmfactor-ai-enabled",
  lineAnchor: "editing-line-anchor-ai-enabled",
  noteSpeed: "editing-note-speed-ai-enabled",
  noteSize: "editing-note-size-ai-enabled",
  noteAlpha: "editing-note-alpha-ai-enabled",
  noteYOffset: "editing-note-y-offset-ai-enabled",
  noteVisibleTime: "editing-note-visible-time-ai-enabled",
  noteColor: "editing-note-color-ai-enabled",
  noteHitSound: "editing-note-hitsound-ai-enabled",
} as const);

/** Every optional editing feature, in the same order as the settings page. */
export const EDITING_FEATURES = Object.freeze(
  Object.keys(EDITING_FEATURE_KEYS) as EditingFeature[],
);

/** The feature whose human switch uses `key`, or null for another setting. */
export function editingFeatureForSetting(key: string): EditingFeature | null {
  const entry = (Object.entries(EDITING_FEATURE_KEYS) as [EditingFeature, string][]).find(
    ([, value]) => value === key,
  );
  return entry?.[0] ?? null;
}
