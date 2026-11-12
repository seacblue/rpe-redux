/** Bridges note-batch lifecycle events to the bounded renderer diagnostics store. */
import {
  recordBatchSubmit,
  recordContextEvent,
  recordNoteBatchState,
  recordTextureUpload,
  type BatchSubmitInput,
  type RenderSurface,
} from "../../../../core/diagnostics/renderMetrics.ts";

/** Keeps the hot batch implementation focused on GPU work rather than report shape. */
export class NoteBatchDiagnostics {
  private readonly surface: RenderSurface;

  /** Create a diagnostics adapter for one renderer surface. */
  constructor(surface: RenderSurface) {
    this.surface = surface;
  }

  /** Record current WebGL, context, and skin-cache state. */
  state(
    gl: WebGL2RenderingContext | null,
    contextLost: boolean,
    active: boolean,
    cachedTextureCount: number,
    queuedTextureCount: number,
  ): void {
    recordNoteBatchState(this.surface, {
      webglAvailable: Boolean(gl),
      active,
      contextLost: contextLost || gl?.isContextLost() === true,
      cachedTextureCount,
      queuedTextureCount,
    });
  }

  /** Record one texture upload attempt. */
  upload(success: boolean): void {
    recordTextureUpload(this.surface, success);
  }

  /** Record one WebGL context transition. */
  context(event: "lost" | "restored"): void {
    recordContextEvent(this.surface, event);
  }

  /** Record one grouped GPU submission. */
  submit(batch: BatchSubmitInput): void {
    recordBatchSubmit(this.surface, batch);
  }
}
