/** Renderer diagnostics expose bounded evidence for WebGL, fallback, and batching health. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  recordBatchSubmit,
  recordContextEvent,
  recordNoteBatchState,
  recordPreviewTiming,
  recordShaderState,
  recordShaderCompile,
  recordTextureUpload,
  renderDiagnosticsSnapshot,
  resetRenderDiagnostics,
} from "../../core/diagnostics/renderMetrics.ts";

test("records renderer availability, skin uploads, fallback, and grouped GPU work", () => {
  resetRenderDiagnostics();
  recordNoteBatchState("preview", {
    webglAvailable: true,
    active: true,
    contextLost: false,
    cachedTextureCount: 8,
    queuedTextureCount: 2,
  });
  recordShaderState("preview", { webglAvailable: true, webgl2: true, active: true });
  recordShaderCompile("preview", true);
  recordShaderCompile("preview", false);
  recordContextEvent("preview", "lost");
  recordContextEvent("preview", "restored");
  recordTextureUpload("preview", true);
  recordTextureUpload("preview", false);
  recordBatchSubmit("preview", {
    groupCount: 12,
    instanceCount: 480,
    bufferSubDataCalls: 12,
    bufferSubDataBytes: 12 * 480 * 15 * 4,
    drawCalls: 12,
    textureBinds: 12,
    maxInstancesPerGroup: 80,
  });
  recordPreviewTiming({
    totalMs: 18,
    setupMs: 1,
    sampleMs: 2,
    visibilityMs: 3,
    visibilityIndexMs: 1,
    visibilityCandidateCount: 500,
    notesMs: 9,
    effectsMs: 1,
    compositeMs: 1,
    visibleNoteCount: 480,
    visibleHoldCount: 20,
    lineCount: 32,
    drawnLineCount: 32,
    drawnNoteCount: 460,
    drawnHoldCount: 20,
    batchFallbackCount: 7,
    fallbackReasons: { texture_unavailable: 7 },
    noteDrawMs: 9,
    lineDrawMs: 2,
    collectGeometry: false,
    noteBatchActive: false,
    renderPath: "mixed",
  });

  const snapshot = renderDiagnosticsSnapshot();
  assert.equal(snapshot.preview.noteBatch.webglAvailable, true);
  assert.equal(snapshot.preview.noteBatch.textureUploads, 1);
  assert.equal(snapshot.preview.noteBatch.textureUploadFailures, 1);
  assert.equal(snapshot.preview.noteBatch.contextLosses, 1);
  assert.equal(snapshot.preview.noteBatch.contextRestores, 1);
  assert.equal(snapshot.preview.shader.webgl2, true);
  assert.equal(snapshot.preview.shader.compileAttempts, 2);
  assert.equal(snapshot.preview.shader.compileFailures, 1);
  assert.equal(snapshot.preview.batches.lastGroupCount, 12);
  assert.equal(snapshot.preview.batches.lastBufferSubDataCalls, 12);
  assert.equal(snapshot.preview.batches.lastTextureBinds, 12);
  assert.equal(snapshot.preview.batches.maxInstancesPerGroup, 80);
  assert.equal(snapshot.preview.batches.lastDrawCalls, 12);
  assert.equal(snapshot.timing.fallbackFrames, 1);
  assert.equal(snapshot.timing.fallbackNotes, 7);
  assert.equal(snapshot.timing.pathCounts.mixed, 1);
  assert.equal(snapshot.timing.fallbackReasons.texture_unavailable, 7);
  assert.equal(snapshot.timing.inactiveFrames, 1);
  assert.equal(snapshot.timing.recent.length, 1);

  resetRenderDiagnostics();
});
