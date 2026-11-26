/**
 * Owns the stable chart-render hierarchy shared by shader masks and preview
 * adapters. Layer ids are semantic; numeric bands only define their ordering.
 */

/** Stable semantic layers exposed to workspace shader passes. */
export const CHART_RENDER_LAYER_IDS = [
  "chart.curve",
  "chart.background-video",
  "chart.judge-line",
  "chart.note.hold",
  "chart.note.drag",
  "chart.note.tap",
  "chart.note.flick",
  "chart.hit-effect",
  "hud.pause",
  "hud.combo",
  "hud.combo-text",
  "hud.score",
  "hud.accuracy",
  "hud.progress",
  "hud.song-title",
  "hud.difficulty",
] as const;

/** A semantic layer that can be selected by a workspace shader. */
export type ChartRenderLayerId = (typeof CHART_RENDER_LAYER_IDS)[number];

/** A layer's default ordering band and optional mask atlas channel. */
export interface ChartRenderLayerDefinition {
  readonly id: ChartRenderLayerId;
  readonly band: number;
  readonly description: string;
  /** RGBA atlas channel for object masks; absent until that renderer exists. */
  readonly maskChannel?: 0 | 1 | 2 | 3;
}

/** PhiZone-compatible semantic ordering: lines occupy the [2, 3) band. */
export const CHART_RENDER_LAYERS: readonly ChartRenderLayerDefinition[] = Object.freeze([
  { id: "chart.curve", band: 0, description: "Curve" },
  { id: "chart.background-video", band: 1, description: "Background video" },
  { id: "chart.judge-line", band: 2, description: "Judge line" },
  { id: "chart.note.hold", band: 3, description: "Hold note", maskChannel: 0 },
  { id: "chart.note.drag", band: 4, description: "Drag note", maskChannel: 1 },
  { id: "chart.note.tap", band: 5, description: "Tap note", maskChannel: 2 },
  { id: "chart.note.flick", band: 6, description: "Flick note", maskChannel: 3 },
  { id: "chart.hit-effect", band: 7, description: "Hit effect" },
  { id: "hud.pause", band: 8, description: "Pause button" },
  { id: "hud.combo", band: 9, description: "Combo counter" },
  { id: "hud.combo-text", band: 10, description: "Combo text" },
  { id: "hud.score", band: 11, description: "Score" },
  { id: "hud.accuracy", band: 12, description: "Accuracy" },
  { id: "hud.progress", band: 13, description: "Progress bar" },
  { id: "hud.song-title", band: 14, description: "Song title" },
  { id: "hud.difficulty", band: 15, description: "Difficulty" },
]);

const LAYER_BY_ID = new Map(CHART_RENDER_LAYERS.map((layer) => [layer.id, layer]));

/** Return the canonical definition for one semantic layer. */
export function chartRenderLayer(id: string): ChartRenderLayerDefinition | null {
  return LAYER_BY_ID.get(id as ChartRenderLayerId) ?? null;
}

/** Return whether a layer currently has an object-mask renderer. */
export function isMaskableChartRenderLayer(id: string): boolean {
  return chartRenderLayer(id)?.maskChannel !== undefined;
}

/** Resolve a note type into the corresponding PhiZone-style render layer. */
export function noteRenderLayer(type: number): ChartRenderLayerId | null {
  switch (type) {
    case 1:
      return "chart.note.tap";
    case 2:
      return "chart.note.hold";
    case 3:
      return "chart.note.drag";
    case 4:
      return "chart.note.flick";
    default:
      return null;
  }
}

/** Convert selected note layers into the four-channel mask-atlas selector. */
export function maskSelectionForLayers(
  layers: readonly ChartRenderLayerId[],
): readonly [number, number, number, number] {
  const selection = [0, 0, 0, 0] as [number, number, number, number];
  for (const id of layers) {
    const channel = chartRenderLayer(id)?.maskChannel;
    if (channel !== undefined) {
      selection[channel] = 1;
    }
  }
  return Object.freeze(selection);
}

/** Produce a stable key for a semantic layer selector. */
export function renderLayerSelectorKey(layers: readonly ChartRenderLayerId[]): string {
  return [...new Set(layers)].sort().join(",");
}

/** Return the numeric band used to order a layer in a composed frame. */
export function renderLayerBand(id: ChartRenderLayerId): number {
  return chartRenderLayer(id)?.band ?? Number.MAX_SAFE_INTEGER;
}
