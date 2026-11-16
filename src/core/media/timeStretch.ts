/**
 * AudioWorklet WSOLA time-stretching for decoded music.
 *
 * The decoded channels are transferred to one long-lived worklet node when the
 * document loads. Starting, pausing, and seeking only send small messages, so a
 * rate change does not copy the song again or schedule grains from the main
 * thread. The DSP uses rate-dependent sequence and overlap lengths to keep slow
 * playback smooth while preserving pitch.
 */
import processorUrl from "./timeStretchProcessor.ts?worker&url";
import transientWorkerUrl from "./timeStretchTransients.ts?worker&url";

const PROCESSOR_NAME = "rpe-time-stretch";
const STOP_FADE_SECONDS = 0.008;
const RESTART_CROSSFADE_SECONDS = 0.008;

interface TransientWorkerScope {
  onmessage: ((event: MessageEvent<{ transients: Int32Array }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

/** Detect optional stretch transients without blocking the browser main thread. */
async function detectTransientsOffThread(
  channels: readonly Float32Array[],
  sampleRate: number,
): Promise<Int32Array> {
  if (typeof Worker === "undefined") {
    // Transient hints improve slow-rate articulation but are not required for correct audio.
    return new Int32Array(0);
  }
  let worker: TransientWorkerScope;
  try {
    worker = new Worker(transientWorkerUrl, {
      type: "module",
    }) as unknown as TransientWorkerScope;
  } catch {
    return new Int32Array(0);
  }
  const copies = channels.map((channel) => channel.slice());
  return await new Promise<Int32Array>((resolve) => {
    let settled = false;
    const finish = (result: Int32Array): void => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (event) => finish(event.data?.transients ?? new Int32Array(0));
    worker.onerror = () => finish(new Int32Array(0));
    try {
      worker.postMessage(
        { channels: copies, sampleRate },
        copies.map((channel) => channel.buffer),
      );
    } catch {
      finish(new Int32Array(0));
    }
  });
}

/** One worklet-backed stretcher for a decoded song. */
export class TimeStretchStretcher {
  private readonly context: AudioContext;
  private readonly node: AudioWorkletNode;
  private readonly output: GainNode;
  private active = false;
  private disposed = false;

  /** Adopt an already connected worklet node and output gain. */
  private constructor(context: AudioContext, node: AudioWorkletNode, output: GainNode) {
    this.context = context;
    this.node = node;
    this.output = output;
  }

  /** Load the processor and transfer one copy of the decoded channels. */
  static async create(
    context: AudioContext,
    buffer: AudioBuffer,
    destination: AudioNode,
  ): Promise<TimeStretchStretcher> {
    const transientsPromise = detectTransientsOffThread(
      Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
        buffer.getChannelData(channel),
      ),
      buffer.sampleRate,
    );
    await context.audioWorklet.addModule(processorUrl);
    const channelCount = buffer.numberOfChannels;
    const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [channelCount],
      channelCount,
      channelCountMode: "explicit",
    });
    const output = context.createGain();
    node.connect(output);
    output.connect(destination);
    const channels = Array.from({ length: channelCount }, (_, channel) =>
      buffer.getChannelData(channel).slice(),
    );
    const transients = await transientsPromise;
    try {
      node.port.postMessage(
        {
          type: "load",
          channels,
          transients,
          length: buffer.length,
        },
        [...channels.map((channel) => channel.buffer), transients.buffer],
      );
    } catch (error) {
      node.disconnect();
      output.disconnect();
      throw error;
    }
    return new TimeStretchStretcher(context, node, output);
  }

  /**
   * Start at `position` and return the context time that maps to it.
   *
   * A negative position means a chart lead-in: the processor waits for the
   * corresponding real time before producing audio. A start while the previous
   * stream is still active crossfades into the replacement instead of leaving a
   * silent gap for the fade and message queue.
   */
  start(position: number, rate: number): number {
    if (this.disposed) {
      return this.context.currentTime;
    }
    const anchor = this.context.currentTime;
    const lead = Math.max(0, -position) / rate;
    this.node.port.postMessage({
      type: "start",
      position: Math.max(0, position),
      rate,
      startAt: anchor + lead,
      fadeSeconds: RESTART_CROSSFADE_SECONDS,
    });
    this.active = true;
    return anchor;
  }

  /** Fade out the current stream without tearing down the node. */
  stop(): void {
    if (!this.active || this.disposed) {
      return;
    }
    this.active = false;
    this.node.port.postMessage({ type: "stop", fadeSeconds: STOP_FADE_SECONDS });
  }

  /** Stop, then disconnect after the fade so closing a document does not click. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.stop();
    this.disposed = true;
    // Disconnect after the processor's fade so closing a document does not click.
    setTimeout(
      () => {
        this.node.disconnect();
        this.output.disconnect();
        this.node.port.close();
      },
      (STOP_FADE_SECONDS + 0.02) * 1000,
    );
  }
}
