/**
 * The editor selection door.
 *
 * The public API speaks in chart coordinates and stable references. It does not
 * expose timeline pixels or React state, so a plugin can select the same notes
 * and events whether the editor is zoomed, scrolled, or rendered headlessly.
 */
import type { EditorFocus, EditorSession } from "../session/session.ts";
import { eventKey, eventListAt, parseEventKey } from "../events/eventTracks.ts";
import { EVENT_TYPES } from "../../global/chart/chart.ts";
import { beatValue } from "../../global/chart/timing/beat.ts";
import { chartFingerprint } from "../document/chartRevision.ts";
import type { SelectionClipboardMode } from "../clipboard/selectionClipboard.ts";
import { extensionRegistry } from "../../extensions/runtime.ts";
import { createLateBound } from "../../utils/lateBound.ts";

export type SelectionMode = "replace" | "add" | "remove" | "toggle";

/** A normal event layer index or the line's extended event map. */
export type EventLayerRef = number | "extended";

/** A chart point used by note range selection. `positionX` is in chart units. */
export interface SelectionPoint {
  beat: number;
  positionX: number;
}

export interface NoteSelectionRequest {
  lineIndex: number;
  indices: readonly number[];
  mode?: SelectionMode;
}

export interface NoteSelectionRangeRequest {
  lineIndex: number;
  from: SelectionPoint;
  to: SelectionPoint;
  mode?: SelectionMode;
}

export interface EventSelectionRequest {
  lineIndex: number;
  eventType: string;
  layer: EventLayerRef;
  indices: readonly number[];
  mode?: SelectionMode;
}

export interface EventSelectionRangeRequest {
  lineIndex: number;
  eventType: string | readonly string[];
  layer: EventLayerRef;
  fromBeat: number;
  toBeat: number;
  mode?: SelectionMode;
}

export interface SelectedNoteRef {
  lineIndex: number;
  index: number;
}

export interface SelectedEventRef {
  lineIndex: number;
  eventType: string;
  layer: EventLayerRef;
  index: number;
}

export interface SelectionApiSnapshot {
  lineIndex: number;
  eventLayer: number;
  focus: EditorFocus;
  notes: readonly SelectedNoteRef[];
  events: readonly SelectedEventRef[];
}

export interface SelectionOperationResult {
  changed: boolean;
  count: number;
  beforeFingerprint: string;
  afterFingerprint: string;
  selection: SelectionApiSnapshot;
}

export interface SelectionPasteRequest {
  beat: number;
  lineIndex: number;
  keepTime?: boolean;
  mirror?: boolean;
}

export interface SelectionApiHost {
  session(): EditorSession;
  clipboard?: {
    copy(): number;
    cut(): number;
    remove(): number;
    pasteAt(beat: number, options: SelectionClipboardMode): boolean;
  };
  /** Synchronize the host view before session listeners refresh it. */
  selectionChanged?(selection: SelectionApiSnapshot): void;
}

/** Validates a selection mode, defaulting to replace. */
function modeOf(mode: SelectionMode | undefined): SelectionMode {
  switch (mode) {
    case undefined:
      return "replace";
    case "replace":
    case "add":
    case "remove":
    case "toggle":
      return mode;
    default:
      throw new RangeError("selection mode must be replace, add, remove, or toggle");
  }
}

/** Rejects empty track names and names containing the key separator. */
function assertEventType(eventType: string): void {
  if (typeof eventType !== "string" || !eventType.trim() || eventType.includes(":")) {
    throw new RangeError("eventType must be a non-empty track name without colons");
  }
}

/** Rejects a non-finite coordinate with a field-qualified message. */
function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite`);
  }
}

/** Rejects a line index outside the chart. */
function assertLine(session: EditorSession, lineIndex: number): void {
  if (
    !Number.isInteger(lineIndex) ||
    lineIndex < 0 ||
    lineIndex >= (session.chart.judgeLineList?.length ?? 0)
  ) {
    throw new RangeError(`lineIndex ${lineIndex} is outside the chart`);
  }
}

/** Rejects a layer that is neither a non-negative integer nor "extended". */
function assertLayer(layer: EventLayerRef): void {
  if (layer !== "extended" && (!Number.isInteger(layer) || layer < 0)) {
    throw new RangeError('layer must be a non-negative integer or "extended"');
  }
}

/** Maps the extended layer to the numeric layer used by session state. */
function normalLayer(layer: EventLayerRef): number {
  return layer === "extended" ? 0 : layer;
}

/** Reports the public layer ref for a track name. */
function layerOf(eventType: string, layer: number): EventLayerRef {
  return (EVENT_TYPES as readonly string[]).includes(eventType) ? layer : "extended";
}

/** Rejects extended-layer addressing for a normal event track. */
function assertLayerForType(layer: EventLayerRef, eventType: string): void {
  if (layer === "extended" && (EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new RangeError("normal event tracks require a numeric layer");
  }
}

/** Switches the session to the requested line and focus, preserving selections. */
function prepareLine(
  session: EditorSession,
  lineIndex: number,
  focus: EditorFocus,
  mode: SelectionMode,
): void {
  assertLine(session, lineIndex);
  const previousLine = session.lineIndex;
  const changedLine = previousLine !== lineIndex;
  const wasMultiLine = session.multiLineActive;
  const selected = focus === "notes" ? session.selection : session.eventSelection;
  if (wasMultiLine || (changedLine && mode !== "replace" && selected.size > 0)) {
    if (!wasMultiLine) {
      // The single-line sets are authoritative; dormant maps are cleared when
      // a plugin starts a new cross-line selection.
      session.multiLineSelection.clear();
      session.multiEventSelection.clear();
      session.multiLineIndices = [previousLine];
    }
    if (!wasMultiLine || session.multiLineMode !== focus) {
      session.multiLineSelection.set(previousLine, new Set(session.selection));
      session.multiEventSelection.set(previousLine, new Set(session.eventSelection));
    }
    session.multiLineEnabled = true;
    session.multiLineMode = focus;
    const selections = focus === "notes" ? session.multiLineSelection : session.multiEventSelection;
    session.multiLineIndices = [
      ...session.multiLineIndices,
      previousLine,
      lineIndex,
      ...selections.keys(),
    ];
    session.normalizeMultiLine();
  }
  session.lineIndex = lineIndex;
  session.focus = focus;
  if (session.multiLineActive && session.multiLineMode === focus) {
    session.selection = new Set(session.multiLineSelection.get(lineIndex) ?? []);
    session.eventSelection = new Set(session.multiEventSelection.get(lineIndex) ?? []);
  } else if (changedLine) {
    session.selection = new Set();
    session.eventSelection = new Set();
  }
}

/** Clears single-line and multi-line note selections. */
function clearNotes(session: EditorSession): void {
  session.selection.clear();
  session.multiLineSelection.clear();
}

/** Clears single-line and multi-line event selections. */
function clearEvents(session: EditorSession): void {
  session.eventSelection.clear();
  session.multiEventSelection.clear();
}

/** Returns the writable note set for a line in the active mode. */
function setForNotes(session: EditorSession, lineIndex: number): Set<number> {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    const selected = session.multiLineSelection.get(lineIndex) ?? new Set<number>();
    session.multiLineSelection.set(lineIndex, selected);
    return selected;
  }
  return session.selection;
}

/** Returns the writable event-key set for a line in the active mode. */
function setForEvents(session: EditorSession, lineIndex: number): Set<string> {
  if (session.multiLineActive && session.multiLineMode === "events") {
    const selected = session.multiEventSelection.get(lineIndex) ?? new Set<string>();
    session.multiEventSelection.set(lineIndex, selected);
    return selected;
  }
  return session.eventSelection;
}

/** Copies a line's multi-line selection into the single-line sets. */
function syncCurrentLine(session: EditorSession, lineIndex: number): void {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    session.selection = new Set(session.multiLineSelection.get(lineIndex) ?? []);
  }
  if (session.multiLineActive && session.multiLineMode === "events") {
    session.eventSelection = new Set(session.multiEventSelection.get(lineIndex) ?? []);
  }
}

/** Records which area owns the current multi-line selection intent. */
function syncMultiSelectionIntent(session: EditorSession, focus: EditorFocus): void {
  const selections =
    focus === "notes" ? session.multiLineSelection.values() : session.multiEventSelection.values();
  const hasSelection = [...selections].some((selection) => selection.size > 0);
  session.multiSelectionIntent =
    session.multiLineActive && session.multiLineMode === focus && hasSelection ? focus : null;
}

/** Returns whether any note or event remains selected in the session. */
function selectionHasObjects(session: EditorSession): boolean {
  return Boolean(
    session.selection.size ||
    session.eventSelection.size ||
    [...session.multiLineSelection.values()].some((selection) => selection.size) ||
    [...session.multiEventSelection.values()].some((selection) => selection.size),
  );
}

/** Applies add, remove, or toggle semantics to a set. */
function applyMode<T>(target: Set<T>, values: readonly T[], mode: SelectionMode): void {
  for (const value of values) {
    if (mode === "remove") {
      target.delete(value);
    } else if (mode === "toggle") {
      target.has(value) ? target.delete(value) : target.add(value);
    } else {
      target.add(value);
    }
  }
}

/** Deduplicates non-negative integers, rejecting invalid indices. */
function validateIndices(indices: readonly number[]): number[] {
  return [...new Set(indices)].filter((index) => {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError("selection indices must be non-negative integers");
    }
    return true;
  });
}

/** Applies one note-index selection request to the session. */
function selectNotes(session: EditorSession, request: NoteSelectionRequest): void {
  const mode = modeOf(request.mode);
  assertLine(session, request.lineIndex);
  const notes = session.chart.judgeLineList?.[request.lineIndex]?.notes ?? [];
  const indices = validateIndices(request.indices).filter((index) => index < notes.length);
  prepareLine(session, request.lineIndex, "notes", mode);
  if (mode === "replace") {
    clearNotes(session);
    clearEvents(session);
  }
  applyMode(setForNotes(session, request.lineIndex), indices, mode);
  syncCurrentLine(session, request.lineIndex);
  syncMultiSelectionIntent(session, "notes");
  session.selectionMode = !selectionHasObjects(session)
    ? "none"
    : mode === "replace"
      ? "single"
      : "multi";
}

/** Selects notes intersecting a beat and chart-X rectangle. */
function selectNoteRange(session: EditorSession, request: NoteSelectionRangeRequest): void {
  assertFinite(request.from.beat, "from.beat");
  assertFinite(request.to.beat, "to.beat");
  assertFinite(request.from.positionX, "from.positionX");
  assertFinite(request.to.positionX, "to.positionX");
  const notes = session.chart.judgeLineList?.[request.lineIndex]?.notes ?? [];
  const bottom = Math.min(request.from.beat, request.to.beat);
  const top = Math.max(request.from.beat, request.to.beat);
  const left = Math.min(request.from.positionX, request.to.positionX);
  const right = Math.max(request.from.positionX, request.to.positionX);
  selectNotes(session, {
    lineIndex: request.lineIndex,
    indices: notes.flatMap((note, index) =>
      beatValue(note.startTime) <= top &&
      beatValue(note.endTime) >= bottom &&
      Number(note.positionX ?? 0) >= left &&
      Number(note.positionX ?? 0) <= right
        ? [index]
        : [],
    ),
    mode: request.mode,
  });
}

/** True when any single-line or multi-line event selection is non-empty. */
function selectionHasEvents(session: EditorSession): boolean {
  return (
    session.eventSelection.size > 0 ||
    [...session.multiEventSelection.values()].some((selection) => selection.size > 0)
  );
}

/** Applies one event-index selection request after layer validation. */
function selectEvents(session: EditorSession, request: EventSelectionRequest): void {
  assertLine(session, request.lineIndex);
  assertLayer(request.layer);
  assertEventType(request.eventType);
  assertLayerForType(request.layer, request.eventType);
  const mode = modeOf(request.mode);
  const layer = normalLayer(request.layer);
  const events = eventListAt(session, request.lineIndex, request.eventType, layer);
  const indices = validateIndices(request.indices).filter((index) => index < events.length);
  if (layer !== session.eventLayer && mode !== "replace" && selectionHasEvents(session)) {
    throw new RangeError(
      "event selection is scoped to one layer; use replace before selecting another layer",
    );
  }
  session.eventLayer = layer;
  prepareLine(session, request.lineIndex, "events", mode);
  if (mode === "replace") {
    clearEvents(session);
    clearNotes(session);
  }
  applyMode(
    setForEvents(session, request.lineIndex),
    indices.map((index) => eventKey(request.eventType, index)),
    mode,
  );
  syncCurrentLine(session, request.lineIndex);
  syncMultiSelectionIntent(session, "events");
  session.selectionMode = !selectionHasObjects(session)
    ? "none"
    : mode === "replace"
      ? "single"
      : "multi";
}

/** Selects overlapping events across one or more tracks in a beat range. */
function selectEventRange(session: EditorSession, request: EventSelectionRangeRequest): void {
  assertLine(session, request.lineIndex);
  assertLayer(request.layer);
  assertFinite(request.fromBeat, "fromBeat");
  assertFinite(request.toBeat, "toBeat");
  const types = [
    ...new Set(typeof request.eventType === "string" ? [request.eventType] : request.eventType),
  ];
  if (!types.length) {
    throw new RangeError("eventType must contain at least one non-empty track name");
  }
  types.forEach(assertEventType);
  types.forEach((eventType) => assertLayerForType(request.layer, eventType));
  const mode = modeOf(request.mode);
  const layer = normalLayer(request.layer);
  const bottom = Math.min(request.fromBeat, request.toBeat);
  const top = Math.max(request.fromBeat, request.toBeat);
  const indicesByType = types.flatMap((eventType) => {
    const events = eventListAt(session, request.lineIndex, eventType, layer);
    return [
      {
        eventType,
        indices: events.flatMap((event, index) =>
          beatValue(event.startTime) <= top && beatValue(event.endTime) >= bottom ? [index] : [],
        ),
      },
    ];
  });
  if (mode === "replace") {
    selectEvents(session, {
      lineIndex: request.lineIndex,
      eventType: indicesByType[0]?.eventType ?? types[0],
      layer: request.layer,
      indices: [],
      mode,
    });
    for (const entry of indicesByType) {
      selectEvents(session, {
        lineIndex: request.lineIndex,
        eventType: entry.eventType,
        layer: request.layer,
        indices: entry.indices,
        mode: "add",
      });
    }
    return;
  }
  for (const entry of indicesByType) {
    selectEvents(session, {
      lineIndex: request.lineIndex,
      eventType: entry.eventType,
      layer: request.layer,
      indices: entry.indices,
      mode,
    });
  }
}

/** Lists selected notes with their line, across multi-line panels. */
function noteRefs(session: EditorSession): SelectedNoteRef[] {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    return [...session.multiLineSelection].flatMap(([lineIndex, indices]) =>
      [...indices]
        .filter((index) => session.chart.judgeLineList?.[lineIndex]?.notes?.[index])
        .map((index) => ({ lineIndex, index })),
    );
  }
  return [...session.selection]
    .filter((index) => session.notes[index])
    .map((index) => ({ lineIndex: session.lineIndex, index }));
}

/** Resolves selected event keys to typed, line-qualified references. */
function eventRefs(session: EditorSession): SelectedEventRef[] {
  const entries =
    session.multiLineActive && session.multiLineMode === "events"
      ? [...session.multiEventSelection].flatMap(([lineIndex, selection]) =>
          [...selection].map((key) => ({ lineIndex, key })),
        )
      : [...session.eventSelection].map((key) => ({ lineIndex: session.lineIndex, key }));
  return entries.flatMap(({ lineIndex, key }) => {
    const parsed = parseEventKey(String(key));
    if (!parsed) {
      return [];
    }
    return eventListAt(session, lineIndex, parsed.type, session.eventLayer)[parsed.index]
      ? [
          {
            lineIndex,
            eventType: parsed.type,
            layer: layerOf(parsed.type, session.eventLayer),
            index: parsed.index,
          },
        ]
      : [];
  });
}

/** Builds the detached selection snapshot returned by the API. */
function snapshot(session: EditorSession): SelectionApiSnapshot {
  return {
    lineIndex: session.lineIndex,
    eventLayer: session.eventLayer,
    focus: session.focus,
    notes: noteRefs(session).sort(
      (left, right) => left.lineIndex - right.lineIndex || left.index - right.index,
    ),
    events: eventRefs(session).sort(
      (left, right) =>
        left.lineIndex - right.lineIndex ||
        left.eventType.localeCompare(right.eventType) ||
        left.index - right.index,
    ),
  };
}

/** Fingerprint of the session's current chart. */
function fingerprint(session: EditorSession): string {
  return chartFingerprint(session.chart);
}

/** Builds the selection facade over one host; disposal blocks later calls. */
export function createSelectionApi(host: SelectionApiHost) {
  let disposed = false;
  const listeners = new Set<(selection: SelectionApiSnapshot) => void>();
  /** Throws once the facade has been disposed. */
  const check = () => {
    if (disposed) {
      throw new Error("Selection API disposed");
    }
  };
  /** Records a selection-only history step and notifies observers. */
  const publishSelection = (
    session: EditorSession,
    beforeSelection: ReturnType<EditorSession["selectionState"]>,
  ): SelectionApiSnapshot => {
    session.recordSelection(undefined, beforeSelection, false);
    const current = snapshot(session);
    host.selectionChanged?.(current);
    for (const listener of [...listeners]) {
      listener(current);
    }
    session.notify();
    return current;
  };
  const session = host.session();
  /** Forwards session changes to API subscribers while mounted. */
  const onSessionChange = () => {
    if (!disposed) {
      const current = snapshot(host.session());
      for (const listener of [...listeners]) {
        listener(current);
      }
    }
  };
  session.addEventListener("change", onSessionChange);
  const api = {
    version: 1,
    state(): SelectionApiSnapshot {
      check();
      return snapshot(host.session());
    },
    subscribe(listener: (selection: SelectionApiSnapshot) => void): () => void {
      check();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear(area: "notes" | "events" | "all" = "all"): SelectionApiSnapshot {
      check();
      if (area !== "notes" && area !== "events" && area !== "all") {
        throw new RangeError("selection area must be notes, events, or all");
      }
      const session = host.session();
      const beforeSelection = session.selectionState();
      if (area === "notes" || area === "all") {
        clearNotes(session);
      }
      if (area === "events" || area === "all") {
        clearEvents(session);
      }
      return publishSelection(session, beforeSelection);
    },
    notes: {
      select(request: NoteSelectionRequest): SelectionApiSnapshot {
        check();
        const session = host.session();
        const beforeSelection = session.selectionState();
        selectNotes(session, request);
        return publishSelection(session, beforeSelection);
      },
      range(request: NoteSelectionRangeRequest): SelectionApiSnapshot {
        check();
        const session = host.session();
        const beforeSelection = session.selectionState();
        selectNoteRange(session, request);
        return publishSelection(session, beforeSelection);
      },
    },
    events: {
      select(request: EventSelectionRequest): SelectionApiSnapshot {
        check();
        const session = host.session();
        const beforeSelection = session.selectionState();
        selectEvents(session, request);
        return publishSelection(session, beforeSelection);
      },
      range(request: EventSelectionRangeRequest): SelectionApiSnapshot {
        check();
        const session = host.session();
        const beforeSelection = session.selectionState();
        selectEventRange(session, request);
        return publishSelection(session, beforeSelection);
      },
    },
    copy(): SelectionOperationResult {
      check();
      if (!host.clipboard) {
        throw new Error("Selection clipboard is unavailable");
      }
      const session = host.session();
      const beforeFingerprint = fingerprint(session);
      const count = host.clipboard.copy();
      const afterFingerprint = fingerprint(session);
      return {
        changed: beforeFingerprint !== afterFingerprint,
        count,
        beforeFingerprint,
        afterFingerprint,
        selection: snapshot(session),
      };
    },
    cut(): SelectionOperationResult {
      check();
      if (!host.clipboard) {
        throw new Error("Selection clipboard is unavailable");
      }
      const session = host.session();
      const beforeFingerprint = fingerprint(session);
      const count = host.clipboard.cut();
      const afterFingerprint = fingerprint(session);
      return {
        changed: beforeFingerprint !== afterFingerprint,
        count,
        beforeFingerprint,
        afterFingerprint,
        selection: snapshot(session),
      };
    },
    delete(): SelectionOperationResult {
      check();
      if (!host.clipboard) {
        throw new Error("Selection clipboard is unavailable");
      }
      const session = host.session();
      const beforeFingerprint = fingerprint(session);
      const count = host.clipboard.remove();
      const afterFingerprint = fingerprint(session);
      return {
        changed: beforeFingerprint !== afterFingerprint,
        count,
        beforeFingerprint,
        afterFingerprint,
        selection: snapshot(session),
      };
    },
    paste(request: SelectionPasteRequest): SelectionOperationResult {
      check();
      if (!host.clipboard) {
        throw new Error("Selection clipboard is unavailable");
      }
      if (!Number.isFinite(request.beat) || !Number.isInteger(request.lineIndex)) {
        throw new RangeError("paste target must contain a finite beat and integer lineIndex");
      }
      const currentSession = host.session();
      const beforeFingerprint = fingerprint(currentSession);
      const before = { request: { ...request }, cancel: false };
      extensionRegistry.emitHook("selection:before-paste", before);
      const changed =
        !before.cancel &&
        host.clipboard.pasteAt(before.request.beat, {
          targetLineIndex: before.request.lineIndex,
          keepTime: before.request.keepTime,
          mirror: before.request.mirror,
        });
      const afterFingerprint = fingerprint(currentSession);
      const result = {
        changed: beforeFingerprint !== afterFingerprint,
        count: changed
          ? snapshot(currentSession).notes.length + snapshot(currentSession).events.length
          : 0,
        beforeFingerprint,
        afterFingerprint,
        selection: snapshot(currentSession),
      };
      extensionRegistry.emitEvent("selection:after-paste", {
        request: before.request,
        result,
      });
      return result;
    },
    dispose(): void {
      disposed = true;
      session.removeEventListener("change", onSessionChange);
      listeners.clear();
    },
  };
  return api;
}

export type SelectionApi = ReturnType<typeof createSelectionApi>;

const selectionApiBinding = createLateBound<SelectionApi>();
const selectionSessionBinding = createLateBound<() => EditorSession>();

/** Binds a selection host and disposes its facade on teardown. */
export function connectSelectionApi(host: SelectionApiHost): () => void {
  const api = createSelectionApi(host);
  const disconnect = selectionApiBinding.bind(api);
  const disconnectSession = selectionSessionBinding.bind(() => host.session());
  return () => {
    disconnectSession();
    disconnect();
    api.dispose();
  };
}

/** The connected selection API; throws when no editor is mounted. */
export function requireSelectionApi(): SelectionApi {
  const api = selectionApiBinding.value();
  if (!api) {
    throw new Error("No editor selection runtime connected");
  }
  return api;
}

/** Read the mounted selection capability without turning absence into an exception. */
export function getSelectionApi(): SelectionApi | null {
  return selectionApiBinding.value();
}

/** Internal editor seam for host-owned declarative steps; not part of the plugin facade. */
export function getSelectionSession(): EditorSession | null {
  return selectionSessionBinding.value()?.() ?? null;
}
