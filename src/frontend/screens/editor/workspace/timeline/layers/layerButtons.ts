/**
 * Publishes the timeline layer-selector snapshot and applies a chosen layer to
 * the session, the only layer authority.
 *
 * Rendering stays in `LayerButtonsView`; this module owns state publication and
 * the selection transition.
 */
import { createValue, type ValueCell } from "../../../../../../core/state/values.ts";
import { t } from "../../../../../../i18n/index.ts";
import { EXTENDED_EVENT_LAYER, MAX_BASE_LAYERS } from "../drawing/tracks.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { LayerButtonItem, LayerButtonsViewProps } from "./LayerButtonsView.tsx";
import type { TimelineLayerReceiver } from "../drawing/timelineReceiver.ts";

export interface LayerButtonsState {
  readonly snapshot: ValueCell<LayerButtonsViewProps | null>;
}

/** Creates the cell published to the layer-button overlay. */
export function createLayerButtonsState(): LayerButtonsState {
  return Object.freeze({
    snapshot: createValue<LayerButtonsViewProps | null>({ initial: null }),
  });
}

/**
 * Switch the active event layer for both the session and the timeline.
 *
 * The gesture setter is the one write that reaches the session, so the layer
 * strip, keyboard shortcuts, and core callers all publish the same value.
 */
export function selectEventLayer(
  timeline: Pick<TimelineLayerReceiver, "cache" | "cancelPlacement" | "eventTypes" | "gestures">,
  session: Pick<EditorSession, "eventSelection" | "notify">,
  index: number,
): void {
  timeline.cancelPlacement();
  timeline.gestures.layer = index;
  timeline.cache.invalidateEvents();
  session.eventSelection.clear();
  timeline.gestures.eventPlacementType = timeline.eventTypes[0];
  session.notify();
}

/** Owns timeline layer status calculation and layer selection. */
export class LayerButtons {
  private readonly getSession: () => EditorSession;
  private readonly timeline: TimelineLayerReceiver;
  private readonly state: LayerButtonsState;
  /** Last published item projection; a session publish alone must not notify. */
  private publishedSignature = "";

  /** Create the selector over the session reader, timeline receiver, and state cell. */
  constructor(
    getSession: () => EditorSession,
    timeline: TimelineLayerReceiver,
    state: LayerButtonsState,
  ) {
    this.getSession = getSession;
    this.timeline = timeline;
    this.state = state;
  }

  /** Rebuild the button snapshot from the current chart and gesture state. */
  render(): void {
    const { getSession, timeline } = this;
    const items: LayerButtonItem[] = [];
    for (let index = 0; index <= MAX_BASE_LAYERS; index++) {
      const extended = index === MAX_BASE_LAYERS;
      items.push({
        index,
        label: extended ? t("editor.app.layer.extended") : String(index),
        active: index === timeline.gestures.layer,
        extended,
        optional: !extended && index > 0,
      });
    }
    // Selection changes republish the session even when the layer strip did
    // not move. The projection is cheap and language-dependent, so compare the
    // completed items and skip the notifying write when they are identical.
    const signature = JSON.stringify(items);
    if (signature === this.publishedSignature) {
      return;
    }
    this.publishedSignature = signature;
    this.state.snapshot.set({
      items,
      onSelect: (index) => {
        selectEventLayer(
          timeline,
          getSession(),
          index === MAX_BASE_LAYERS ? EXTENDED_EVENT_LAYER : index,
        );
      },
    });
  }

  /** Clear the published snapshot so the overlay unmounts. */
  dispose(): void {
    this.publishedSignature = "";
    this.state.snapshot.set(null);
  }
}
