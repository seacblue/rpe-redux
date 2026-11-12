/** One outstanding render or heartbeat; pointer events coalesce into that slot. */
export class EditorFrameScheduler {
  private frame: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private continuous = false;
  private hidden = false;
  private readonly callback: FrameRequestCallback;
  /** Stores the frame callback; scheduling starts on the first `wake`. */
  constructor(callback: FrameRequestCallback) {
    this.callback = callback;
  }
  /** Requests one animation frame unless one is already pending. */
  wake(): void {
    if (this.disposed || this.frame !== undefined) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    this.frame = requestAnimationFrame((timestamp) => {
      this.frame = undefined;
      if (!this.disposed) {
        // Register the following display callback before synchronous painting.
        // When the current frame is close to its budget, waiting until the end
        // can miss the next compositor deadline even though the next frame is
        // otherwise cheap enough to render.
        if (this.continuous && !this.hidden) {
          this.wake();
        }
        this.callback(timestamp);
      }
    });
  }
  /** Continues animation frames while visible, otherwise schedules a timed heartbeat. */
  schedule(continuous: boolean, hidden: boolean, playing: boolean): void {
    if (this.disposed) {
      return;
    }
    this.continuous = continuous;
    this.hidden = hidden;
    if (continuous && !hidden) {
      this.wake();
      return;
    }
    if (this.frame !== undefined || this.timer !== undefined) {
      return;
    }
    // Background playback needs frequent audio scheduling; an idle workspace
    // only needs a heartbeat for elapsed editing time and automatic recovery.
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        if (!this.disposed) {
          this.callback(performance.now());
        }
      },
      playing ? 100 : 500,
    );
  }
  /** Cancels any pending frame or heartbeat and ignores later scheduling. */
  dispose(): void {
    this.disposed = true;
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
    }
    clearTimeout(this.timer);
    this.frame = undefined;
    this.timer = undefined;
    this.continuous = false;
    this.hidden = false;
  }
}
