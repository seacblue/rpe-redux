/** Collects bounded renderer health counters for diagnostic bundles. */

/** Renderer surface that owns a batch or shader pipeline. */
export type RenderSurface = "preview" | "timeline";

/** High-level path used to paint the note portion of a preview frame. */
export type RenderPath = "webgl_batch" | "canvas_fallback" | "mixed";

/** The timing fields needed by the renderer diagnostics store. */
export interface RenderTimingInput {
  totalMs: number;
  setupMs: number;
  sampleMs: number;
  visibilityMs: number;
  visibilityIndexMs: number;
  visibilityCandidateCount: number;
  notesMs: number;
  effectsMs: number;
  compositeMs: number;
  visibleNoteCount: number;
  visibleHoldCount: number;
  lineCount: number;
  drawnLineCount: number;
  drawnNoteCount: number;
  drawnHoldCount: number;
  batchFallbackCount: number;
  fallbackReasons: Record<string, number>;
  noteDrawMs: number;
  lineDrawMs: number;
  collectGeometry: boolean;
  noteBatchActive: boolean;
  renderPath: RenderPath;
}

/** Current WebGL and skin-batch state for one renderer surface. */
export interface NoteBatchStateInput {
  webglAvailable: boolean;
  active: boolean;
  contextLost: boolean;
  cachedTextureCount: number;
  queuedTextureCount: number;
}

/** One submission's bounded GPU batch counters. */
export interface BatchSubmitInput {
  groupCount: number;
  instanceCount: number;
  bufferSubDataCalls: number;
  bufferSubDataBytes: number;
  drawCalls: number;
  textureBinds: number;
  maxInstancesPerGroup: number;
}

/** Shader pipeline availability for a renderer surface. */
export interface ShaderStateInput {
  webglAvailable: boolean;
  webgl2: boolean;
  active: boolean;
  programCount?: number;
  lastErrorPresent?: boolean;
}

interface SurfaceMetrics {
  noteBatch: {
    webglAvailable: boolean;
    active: boolean;
    contextLost: boolean;
    cachedTextureCount: number;
    queuedTextureCount: number;
    textureUploads: number;
    textureUploadFailures: number;
    contextLosses: number;
    contextRestores: number;
  };
  shader: {
    webglAvailable: boolean;
    webgl2: boolean;
    active: boolean;
    programCount: number;
    lastErrorPresent: boolean;
    compileAttempts: number;
    compileSuccesses: number;
    compileFailures: number;
  };
  batches: {
    frames: number;
    lastGroupCount: number;
    lastInstanceCount: number;
    lastBufferSubDataCalls: number;
    lastBufferSubDataBytes: number;
    lastDrawCalls: number;
    lastTextureBinds: number;
    lastAverageInstancesPerGroup: number;
    maxGroupCount: number;
    maxBufferSubDataCalls: number;
    maxInstancesPerGroup: number;
    maxDrawCalls: number;
    totalBufferSubDataCalls: number;
    totalBufferSubDataBytes: number;
    totalDrawCalls: number;
    totalTextureBinds: number;
  };
}

interface TimingMetrics {
  frames: number;
  fallbackFrames: number;
  fallbackNotes: number;
  maxFallbackCount: number;
  inactiveFrames: number;
  pathCounts: Record<RenderPath, number>;
  fallbackReasons: Record<string, number>;
  last: RenderTimingInput | null;
  recent: RenderTimingInput[];
}

/** JSON-safe renderer diagnostics included in the exported report. */
export interface RenderDiagnosticsSnapshot {
  preview: SurfaceMetrics;
  timeline: SurfaceMetrics;
  timing: TimingMetrics;
}

function emptySurface(): SurfaceMetrics {
  return {
    noteBatch: {
      webglAvailable: false,
      active: false,
      contextLost: false,
      cachedTextureCount: 0,
      queuedTextureCount: 0,
      textureUploads: 0,
      textureUploadFailures: 0,
      contextLosses: 0,
      contextRestores: 0,
    },
    shader: {
      webglAvailable: false,
      webgl2: false,
      active: false,
      programCount: 0,
      lastErrorPresent: false,
      compileAttempts: 0,
      compileSuccesses: 0,
      compileFailures: 0,
    },
    batches: {
      frames: 0,
      lastGroupCount: 0,
      lastInstanceCount: 0,
      lastBufferSubDataCalls: 0,
      lastBufferSubDataBytes: 0,
      lastDrawCalls: 0,
      lastTextureBinds: 0,
      lastAverageInstancesPerGroup: 0,
      maxGroupCount: 0,
      maxBufferSubDataCalls: 0,
      maxInstancesPerGroup: 0,
      maxDrawCalls: 0,
      totalBufferSubDataCalls: 0,
      totalBufferSubDataBytes: 0,
      totalDrawCalls: 0,
      totalTextureBinds: 0,
    },
  };
}

const metrics: RenderDiagnosticsSnapshot = {
  preview: emptySurface(),
  timeline: emptySurface(),
  timing: {
    frames: 0,
    fallbackFrames: 0,
    fallbackNotes: 0,
    maxFallbackCount: 0,
    inactiveFrames: 0,
    pathCounts: { webgl_batch: 0, canvas_fallback: 0, mixed: 0 },
    fallbackReasons: {},
    last: null,
    recent: [],
  },
};

function boundedCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 1_000_000) : 0;
}

function boundedBytes(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 64 << 20) : 0;
}

function boundedDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 60_000) : 0;
}

/** Record whether the skin batch currently has a usable WebGL context. */
export function recordNoteBatchState(surface: RenderSurface, state: NoteBatchStateInput): void {
  metrics[surface].noteBatch = {
    webglAvailable: state.webglAvailable,
    active: state.active,
    contextLost: state.contextLost,
    cachedTextureCount: boundedCount(state.cachedTextureCount),
    queuedTextureCount: boundedCount(state.queuedTextureCount),
    textureUploads: metrics[surface].noteBatch.textureUploads,
    textureUploadFailures: metrics[surface].noteBatch.textureUploadFailures,
    contextLosses: metrics[surface].noteBatch.contextLosses,
    contextRestores: metrics[surface].noteBatch.contextRestores,
  };
}

/** Record one WebGL context loss or restoration for a batch surface. */
export function recordContextEvent(surface: RenderSurface, event: "lost" | "restored"): void {
  const batch = metrics[surface].noteBatch;
  if (event === "lost") {
    batch.contextLosses += 1;
  } else {
    batch.contextRestores += 1;
  }
}

/** Record one skin texture upload attempt. */
export function recordTextureUpload(surface: RenderSurface, success: boolean): void {
  const batch = metrics[surface].noteBatch;
  if (success) {
    batch.textureUploads += 1;
  } else {
    batch.textureUploadFailures += 1;
  }
}

/** Record whether the shader path found a WebGL context and rendered actively. */
export function recordShaderState(surface: RenderSurface, state: ShaderStateInput): void {
  const shader = metrics[surface].shader;
  metrics[surface].shader = {
    webglAvailable: state.webglAvailable,
    webgl2: state.webgl2,
    active: state.active,
    programCount: state.programCount ?? shader.programCount,
    lastErrorPresent: state.lastErrorPresent ?? shader.lastErrorPresent,
    compileAttempts: shader.compileAttempts,
    compileSuccesses: shader.compileSuccesses,
    compileFailures: shader.compileFailures,
  };
}

/** Record one shader compile or link result without retaining source text. */
export function recordShaderCompile(surface: RenderSurface, success: boolean): void {
  const shader = metrics[surface].shader;
  shader.compileAttempts += 1;
  if (success) {
    shader.compileSuccesses += 1;
    shader.lastErrorPresent = false;
  } else {
    shader.compileFailures += 1;
    shader.lastErrorPresent = true;
  }
}

/** Record one grouped note-batch submission. */
export function recordBatchSubmit(surface: RenderSurface, input: BatchSubmitInput): void {
  const batches = metrics[surface].batches;
  const groupCount = boundedCount(input.groupCount);
  const instanceCount = boundedCount(input.instanceCount);
  const bufferSubDataCalls = boundedCount(input.bufferSubDataCalls);
  const bufferSubDataBytes = boundedBytes(input.bufferSubDataBytes);
  const drawCalls = boundedCount(input.drawCalls);
  const textureBinds = boundedCount(input.textureBinds);
  const maxInstancesPerGroup = boundedCount(input.maxInstancesPerGroup);
  batches.frames += 1;
  batches.lastGroupCount = groupCount;
  batches.lastInstanceCount = instanceCount;
  batches.lastBufferSubDataCalls = bufferSubDataCalls;
  batches.lastBufferSubDataBytes = bufferSubDataBytes;
  batches.lastDrawCalls = drawCalls;
  batches.lastTextureBinds = textureBinds;
  batches.lastAverageInstancesPerGroup = groupCount ? instanceCount / groupCount : 0;
  batches.maxGroupCount = Math.max(batches.maxGroupCount, groupCount);
  batches.maxBufferSubDataCalls = Math.max(batches.maxBufferSubDataCalls, bufferSubDataCalls);
  batches.maxInstancesPerGroup = Math.max(batches.maxInstancesPerGroup, maxInstancesPerGroup);
  batches.maxDrawCalls = Math.max(batches.maxDrawCalls, drawCalls);
  batches.totalBufferSubDataCalls += bufferSubDataCalls;
  batches.totalBufferSubDataBytes += bufferSubDataBytes;
  batches.totalDrawCalls += drawCalls;
  batches.totalTextureBinds += textureBinds;
}

/** Record one preview timing sample and retain only a small recent window. */
export function recordPreviewTiming(sample: RenderTimingInput): void {
  const timing = metrics.timing;
  const fallbackReasons = Object.fromEntries(
    Object.entries(sample.fallbackReasons)
      .filter(([reason]) => /^[a-z_]{1,48}$/u.test(reason))
      .slice(0, 16)
      .map(([reason, count]) => [reason, boundedCount(count)]),
  );
  const safeSample: RenderTimingInput = {
    totalMs: boundedDuration(sample.totalMs),
    setupMs: boundedDuration(sample.setupMs),
    sampleMs: boundedDuration(sample.sampleMs),
    visibilityMs: boundedDuration(sample.visibilityMs),
    visibilityIndexMs: boundedDuration(sample.visibilityIndexMs),
    visibilityCandidateCount: boundedCount(sample.visibilityCandidateCount),
    notesMs: boundedDuration(sample.notesMs),
    effectsMs: boundedDuration(sample.effectsMs),
    compositeMs: boundedDuration(sample.compositeMs),
    visibleNoteCount: boundedCount(sample.visibleNoteCount),
    visibleHoldCount: boundedCount(sample.visibleHoldCount),
    lineCount: boundedCount(sample.lineCount),
    drawnLineCount: boundedCount(sample.drawnLineCount),
    drawnNoteCount: boundedCount(sample.drawnNoteCount),
    drawnHoldCount: boundedCount(sample.drawnHoldCount),
    batchFallbackCount: boundedCount(sample.batchFallbackCount),
    fallbackReasons,
    noteDrawMs: boundedDuration(sample.noteDrawMs),
    lineDrawMs: boundedDuration(sample.lineDrawMs),
    collectGeometry: Boolean(sample.collectGeometry),
    noteBatchActive: Boolean(sample.noteBatchActive),
    renderPath: sample.renderPath,
  };
  timing.frames += 1;
  timing.fallbackFrames += safeSample.batchFallbackCount > 0 ? 1 : 0;
  timing.fallbackNotes += safeSample.batchFallbackCount;
  timing.maxFallbackCount = Math.max(timing.maxFallbackCount, safeSample.batchFallbackCount);
  timing.inactiveFrames += safeSample.noteBatchActive ? 0 : 1;
  timing.pathCounts[safeSample.renderPath] += 1;
  for (const [reason, count] of Object.entries(fallbackReasons)) {
    timing.fallbackReasons[reason] = (timing.fallbackReasons[reason] ?? 0) + count;
  }
  timing.last = safeSample;
  timing.recent.push(safeSample);
  if (timing.recent.length > 8) {
    timing.recent.shift();
  }
}

/** Reset renderer metrics for deterministic tests and a fresh app session. */
export function resetRenderDiagnostics(): void {
  metrics.preview = emptySurface();
  metrics.timeline = emptySurface();
  metrics.timing = {
    frames: 0,
    fallbackFrames: 0,
    fallbackNotes: 0,
    maxFallbackCount: 0,
    inactiveFrames: 0,
    pathCounts: { webgl_batch: 0, canvas_fallback: 0, mixed: 0 },
    fallbackReasons: {},
    last: null,
    recent: [],
  };
}

/** Latest preview timing sample, or null before the first painted preview frame. */
export function lastRenderTiming(): Readonly<RenderTimingInput> | null {
  return metrics.timing.last;
}

/** Return a detached renderer snapshot safe to serialize into a support zip. */
export function renderDiagnosticsSnapshot(): RenderDiagnosticsSnapshot {
  return JSON.parse(JSON.stringify(metrics)) as RenderDiagnosticsSnapshot;
}
