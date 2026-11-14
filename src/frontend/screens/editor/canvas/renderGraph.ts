/** Retains backend-neutral draw packets until a surface revision changes. */

/** One backend-neutral primitive understood by the editor render devices. */
export type RenderCommand =
  | {
      readonly kind: "fillRect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly color: string;
      readonly alpha: number;
    }
  | {
      readonly kind: "strokeRect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly color: string;
      readonly lineWidth: number;
      readonly alpha: number;
      readonly offset: number;
    }
  | {
      readonly kind: "polyline";
      readonly points: readonly number[];
      readonly color: string;
      readonly lineWidth: number;
      readonly alpha: number;
    }
  | {
      readonly kind: "text";
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly maxWidth?: number;
      readonly font: string;
      readonly color: string;
      readonly align: CanvasTextAlign;
      readonly alpha: number;
    };

/** Complete retained contents for one logical surface. */
export interface RenderPacket {
  readonly surface: string;
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly commands: readonly RenderCommand[];
}

/** Adapter that knows how to submit one backend-neutral packet. */
export interface RenderDevice<Packet = RenderPacket> {
  render(packet: Packet): void;
  dispose(): void;
}

interface RetainedPacket {
  readonly key: string;
  readonly packet: RenderPacket;
}

/** Retained render graph with one small interface for surface submission. */
export class RenderGraph {
  private readonly retained = new Map<string, RetainedPacket>();

  /** Submit only when the packet key differs from the last committed surface. */
  submit(packet: RenderPacket, device: RenderDevice<RenderPacket>): boolean {
    const previous = this.retained.get(packet.surface);
    if (previous?.key === packet.key) {
      return false;
    }
    device.render(packet);
    this.retained.set(packet.surface, { key: packet.key, packet });
    return true;
  }

  /** Forget one surface so its next packet is guaranteed to paint. */
  invalidate(surface: string): void {
    this.retained.delete(surface);
  }

  /** Forget retained packet metadata and release every device. */
  dispose(devices: Iterable<RenderDevice<RenderPacket>>): void {
    this.retained.clear();
    for (const device of devices) {
      device.dispose();
    }
  }
}
