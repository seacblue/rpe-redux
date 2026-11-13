/**
 * Instance-group bookkeeping for the note batch.
 *
 * A group batches the quads that share one skin texture. Groups outlive a
 * frame so their instance arrays are reused, which means paint order cannot
 * follow submission order: groups are partitioned by paint layer and the batch
 * replays the layers in order. Selected instances keep their own foreground
 * layer. The Hold-below-heads rule is defined here for both renderers.
 */

/** A note's authored multiply tint or its selected-state recoloring. */
export type NoteColor = { mode: "tint" | "selected"; color: number[] };

/** One decoded skin bitmap and the useful rectangle inside it. */
export interface TextureDescriptor {
  readonly source: HTMLImageElement;
  readonly useful: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** Instances sharing one texture, with their packed vertex data. */
export interface SpriteGroup {
  descriptor: TextureDescriptor;
  instances: Float32Array;
  count: number;
}

/** One texture group map; the batch keeps one per paint layer. */
type SpriteGroupMap = Map<HTMLImageElement, SpriteGroup>;

/** Floats per instance: transform, rotation, shear, UV rect, alpha, tint, and colorize mode. */
export const INSTANCE_STRIDE = 15;

/** A paint layer inside one frame; lower layers are painted first. */
export type NotePaintLayer = 0 | 1;

/**
 * Paint layers inside one frame, drawn in ascending order.
 *
 * A Hold paints in the lower layer so its body and caps never cover a Tap,
 * Drag, or Flick head at the same lane.
 */
export const HOLD_PAINT_LAYER: NotePaintLayer = 0;
export const HEAD_PAINT_LAYER: NotePaintLayer = 1;

/**
 * Paint layer of one note type.
 *
 * This is the single definition of the Hold-below-heads rule: the timeline
 * sorts its Canvas path by it and the batch sorts its texture groups by it.
 */
export function notePaintLayer(type: number): NotePaintLayer {
  return type === 2 ? HOLD_PAINT_LAYER : HEAD_PAINT_LAYER;
}

/** Texture groups per paint layer, plus the selected instances' foreground pass. */
export class NoteSpriteGroups {
  /** Judge-line groups paint beneath every note and Hold. */
  readonly line: SpriteGroupMap = new Map();
  /** Ordinary groups per paint layer; lower layers are painted first. */
  readonly layers: [SpriteGroupMap, SpriteGroupMap] = [new Map(), new Map()];
  /** Selected instances render as a foreground pass so overlap cannot hide the selection. */
  readonly selected: SpriteGroupMap = new Map();

  /** Take the group of one instance, creating its buffer on first use. */
  group(descriptor: TextureDescriptor, layer: NotePaintLayer, selected: boolean): SpriteGroup {
    return this.groupFor(selected ? this.selected : this.layers[layer], descriptor);
  }

  /** Take the group of one judge-line instance. */
  lineGroup(descriptor: TextureDescriptor): SpriteGroup {
    return this.groupFor(this.line, descriptor);
  }

  private groupFor(groups: SpriteGroupMap, descriptor: TextureDescriptor): SpriteGroup {
    let group = groups.get(descriptor.source);
    if (!group) {
      group = {
        descriptor,
        instances: new Float32Array(INSTANCE_STRIDE * 64),
        count: 0,
      };
      groups.set(descriptor.source, group);
    }
    return group;
  }

  /** Reset every group's instance count so the next frame rebuilds its uploads. */
  reset(): void {
    for (const group of this.line.values()) {
      group.count = 0;
    }
    for (const groups of this.layers) {
      for (const group of groups.values()) {
        group.count = 0;
      }
    }
    for (const group of this.selected.values()) {
      group.count = 0;
    }
  }

  /** Drop every group; the backing buffers rebuild on first use. */
  clear(): void {
    this.line.clear();
    for (const groups of this.layers) {
      groups.clear();
    }
    this.selected.clear();
  }
}
