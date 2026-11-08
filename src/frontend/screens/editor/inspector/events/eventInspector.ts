/**
 * Builds inspector rows for selected chart events, including shader fields.
 *
 * It normalizes single-line and multi-line selections into view entries and
 * leaves mutation to event editor commands. Rendering belongs to the paired
 * React views; this file is the presenter/model adapter.
 */
import { selectedEvents } from "../../../../../core/edit/events/eventEdits.ts";
import { eventListAt } from "../../../../../core/edit/events/eventTracks.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { TempoGrid } from "../../../../../core/global/chart/editing/editGrid.ts";
import type { Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { getLanguage } from "../../../../../i18n/index.ts";
import { renderShaderInspector } from "./shader/shaderInspector.ts";
import type { EventInspectorState } from "./model.ts";
import type { InspectorEventEntry } from "./EventInspectorView.tsx";
import type { EasingCurvePatch } from "../../../../../design/components/easing/EasingCurveEditor.tsx";
import type { Timeline } from "../../workspace/timeline/surface/timeline.ts";
import { eventCurvePreviewSession } from "./eventCurvePreview.ts";
import { currentDocumentStore } from "../../../../platform/documentStoreHandle.ts";
import { shaderAssetPath } from "../../../../../core/global/chart/shader/shader.ts";
export type { InspectorEventEntry } from "./EventInspectorView.tsx";

/** Collects the selected events from the single-line or multi-line selection. */
function inspectorEntries(session: EditorSession): InspectorEventEntry[] {
  if (session.multiLineActive && session.multiLineMode === "events") {
    return [...(session.multiEventSelection ?? new Map())]
      .flatMap(([lineIndex, keys]) =>
        [...keys].map((key) => {
          const [type, indexText] = String(key).split(":");
          const index = Number(indexText);
          return { type, index, lineIndex, event: eventListAt(session, lineIndex, type)?.[index] };
        }),
      )
      .filter((entry) => entry.event);
  }
  return selectedEvents(session);
}

/** Inputs that determine the published event inspector rows. */
interface EventRenderContext {
  chart: EditorSession["chart"];
  lineIndex: number;
  layer: number;
  tempo: TempoGrid;
  multiLineActive: boolean;
  multiLineMode: string;
  language: string;
  entries: InspectorEventEntry[];
  shaderAssets: string;
}

/** The last published context per inspector state; see `noteInspector.ts`. */
const renderContexts = new WeakMap<EventInspectorState, EventRenderContext>();

/** Compares two selections by type, index, line, and event identity. */
function sameEntries(left: InspectorEventEntry[], right: InspectorEventEntry[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.type === right[index]?.type &&
        entry.index === right[index]?.index &&
        entry.lineIndex === right[index]?.lineIndex &&
        entry.event === right[index]?.event,
    )
  );
}

/** Publishes the event or shader inspector for the current selection. */
export function renderEventInspector(
  session: EditorSession,
  tempo: TempoGrid,
  currentBeat: () => number,
  reportError: (error: unknown) => void,
  notify: (message: string, kind?: string) => void = () => {},
  onNudge: (value: Beat, direction: number) => Beat | null = () => null,
  timeline: Pick<Timeline, "setPreview" | "changed">,
  state: EventInspectorState,
): void {
  const entries = inspectorEntries(session);
  const language = getLanguage();
  const shaderAssets = [...(currentDocumentStore()?.assets?.names ?? [])]
    .filter((name) => Boolean(shaderAssetPath(name)))
    .sort()
    .join("\u0000");
  const previous = renderContexts.get(state);
  if (
    previous &&
    previous.chart === session.chart &&
    previous.lineIndex === session.lineIndex &&
    previous.layer === session.eventLayer &&
    previous.tempo === tempo &&
    previous.multiLineActive === session.multiLineActive &&
    previous.multiLineMode === session.multiLineMode &&
    previous.language === language &&
    previous.shaderAssets === shaderAssets &&
    sameEntries(previous.entries, entries)
  ) {
    return;
  }
  renderContexts.set(state, {
    chart: session.chart,
    lineIndex: session.lineIndex,
    layer: session.eventLayer,
    tempo,
    multiLineActive: session.multiLineActive,
    multiLineMode: session.multiLineMode,
    language,
    entries,
    shaderAssets,
  });
  const entry = entries[0];
  state.selectedCount.set(entries.length);
  const refresh = () =>
    renderEventInspector(
      session,
      tempo,
      currentBeat,
      reportError,
      notify,
      onNudge,
      timeline,
      state,
    );
  const onCurvePreview = (patch: EasingCurvePatch | null) => {
    if (!patch?.bezierPoints) {
      timeline.setPreview(null);
      timeline.changed();
      return;
    }
    timeline.setPreview(eventCurvePreviewSession(session, patch.bezierPoints));
    timeline.changed();
  };
  if (entry?.type === "paintEvents") {
    timeline.setPreview(null);
    renderShaderInspector(session, reportError, refresh, state);
    return;
  }
  const revision = state.beginUpdate();
  const props = {
    session,
    tempo,
    entry,
    currentBeat,
    reportError,
    notify,
    refresh,
    onCurvePreview,
    setLiveEventEdit: (active: boolean) => {
      session.liveEventEdit = active;
    },
    setEventSelection: (selection: Set<string>) => {
      session.eventSelection = selection;
      session.notify();
    },
    onNudge,
  };
  void import("./EventInspectorView.tsx")
    .then(({ EventInspectorView }) => {
      if (state.isCurrentUpdate(revision)) {
        state.inspector.set({ kind: "event", component: EventInspectorView, props });
      }
    })
    .catch(reportError);
}
