/** Owns the React refs for the timeline's canvas surface. */
import {
  createDomSurface,
  type DomSurfaceHandle,
  type DomSurfaceProviderProps,
} from "../../../../../contracts/domSurface.ts";
import type { TimelineSurface } from "../../runtime/composition/editorSurfaces.ts";

/** Refs and attach callbacks for every timeline surface node. */
export type TimelineDomSurfaceHandle = DomSurfaceHandle<TimelineSurface>;

const timelineSurface = createDomSurface<TimelineSurface>(
  [
    "stage",
    "notesBackdrop",
    "notesGridBatch",
    "notesPlayhead",
    "notesPlayheadBatch",
    "notes",
    "noteBatch",
    "noteSolidBatch",
    "eventsBackdrop",
    "eventsGridBatch",
    "eventsPlayhead",
    "eventsPlayheadBatch",
    "events",
    "eventBatch",
    "eventOverlayBatch",
    "selectionOverlay",
    "selectionOverlayBatch",
    "audioAnalysisOverlay",
    "noteDensity",
    "history",
  ],
  {
    selector: (key) => `timeline.${String(key)}`,
    provider: "TimelineDomSurfaceProvider",
    listMissing: true,
  },
);

/** Create the ref cells and attach callbacks for every timeline surface node. */
export function createTimelineDomSurface(): TimelineDomSurfaceHandle {
  return timelineSurface.create();
}

/** Provide the surface handle to the timeline subtree. */
export function TimelineDomSurfaceProvider(props: DomSurfaceProviderProps<TimelineSurface>) {
  return timelineSurface.Provider(props);
}

/** Read the enclosing timeline surface handle. */
export function useTimelineDomSurface(): TimelineDomSurfaceHandle {
  return timelineSurface.useSurface();
}
