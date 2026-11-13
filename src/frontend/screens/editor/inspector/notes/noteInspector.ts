/**
 * Builds and commits the note property rows for the current selection, including
 * hold durations and above/below placement.
 *
 * Writes go through the captured selection edit path, and a beat a descriptor
 * refuses never reaches the chart.
 */
import {
  addBeatFraction,
  addBeats,
  beatCopy,
  compareBeats,
  fromNumber,
  maxBeat,
  subtractBeats,
  type Beat,
} from "../../../../../core/global/chart/timing/beat.ts";
import { noteIsAbove, type JudgeLineNote } from "../../../../../core/global/chart/chart.ts";
import {
  noteHasColor,
  noteHasCustomAlpha,
  noteHasCustomSize,
  noteHasCustomSpeed,
  noteHasCustomVisibleTime,
  noteHasCustomYOffset,
  noteHasHitSound,
} from "../../../../../core/global/chart/optionalFeatures.ts";
import {
  visibleBeats,
  visibleSeconds,
} from "../../../../../core/global/chart/editing/noteEditing.ts";
import type { TempoGrid } from "../../../../../core/global/chart/editing/editGrid.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import {
  captureSelection,
  type NoteCaptureEntry,
} from "../../../../../core/edit/selection/snapshot.ts";
import {
  commitSelectionEdit,
  editCapturedSelection,
} from "../../../../../core/edit/selection/edits.ts";
import { getLanguage, t } from "../../../../../i18n/index.ts";
import { type NotesInspectorState, type NotePropertyField, type PropertyControl } from "./model.ts";

type FieldName =
  | "type"
  | "startTime"
  | "endTime"
  | "positionX"
  | "above"
  | "isFake"
  | "speed"
  | "size"
  | "alpha"
  | "yOffset"
  | "visibleTime"
  | "hitSound"
  | "color";
type FieldKind = NotePropertyField["kind"];
type FieldOptions = object | number;

let revision = 0;

/** Present an authored RGB triple as the hex value the text control edits. */
function colorHex(value: unknown): string {
  if (!Array.isArray(value) || value.length < 3) {
    return "";
  }
  const channels = value.slice(0, 3).map((channel) => {
    const number = Number(channel);
    return Math.max(0, Math.min(255, Math.round(number)))
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

/** Parses `#RRGGBB` into an RGB triple; an invalid value throws. */
function parseColor(text: string): number[] | null {
  if (!text.trim()) {
    return null;
  }
  const match = /^#([0-9a-f]{6})$/i.exec(text.trim());
  if (!match) {
    throw new Error(t("editorPanels.inspector.colorHexInvalid"));
  }
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

/** Inputs that determine the published note property rows. */
interface PropertiesRenderContext {
  chart: EditorSession["chart"];
  lineIndex: number;
  tempo: TempoGrid;
  division: number;
  multiLineActive: boolean;
  multiLineMode: string;
  language: string;
  entries: NoteCaptureEntry[];
}

/**
 * The last published context per inspector state.
 *
 * Session notifications also fire for event selection and other UI state. When
 * none of the note fields can have changed, rebuilding the same row descriptors
 * only wakes React for another identical render.
 */
const renderContexts = new WeakMap<NotesInspectorState, PropertiesRenderContext>();

/** Compares two note selections by line, index, and note identity. */
function sameEntries(left: NoteCaptureEntry[], right: NoteCaptureEntry[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.lineIndex === right[index]?.lineIndex &&
        entry.index === right[index]?.index &&
        entry.note === right[index]?.note,
    )
  );
}

/** Clears the cached render context and the published property snapshot. */
export function disposeProperties(state: NotesInspectorState): void {
  renderContexts.delete(state);
  state.properties.set(null);
}

/** Collects the current note selection in single-line or multi-line mode. */
function selectedNoteEntries(session: EditorSession): NoteCaptureEntry[] {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    return session.selectedNoteEntries();
  }
  return [...session.selection]
    .map((index) => ({ lineIndex: session.lineIndex, index, note: session.notes[index] }))
    .filter((entry) => entry.note);
}

/** Applies a note transform through the active selection edit path. */
function applyNoteTransform(
  session: EditorSession,
  label: string,
  transform: (note: JudgeLineNote, entry?: NoteCaptureEntry) => JudgeLineNote,
): void {
  if (session.multiLineActive && session.multiLineMode === "notes") {
    const result = editCapturedSelection(captureSelection(session), { note: transform });
    commitSelectionEdit(session, result, label, {}, { normalized: true });
  } else {
    session.transformSelection(label, transform);
  }
}

/** Publishes property descriptors for the selected note, if any. */
export function renderProperties(
  session: EditorSession,
  state: NotesInspectorState,
  tempo: TempoGrid,
  reportError: (error: unknown) => void,
  // One exact grid division, shared with every other beat control on the session.
  nudgeBeatInput: (value: Beat, direction: number) => Beat | null = () => null,
  // Structural changes may need to publish while a control still owns focus.
  forceRefresh = false,
): void {
  if (session.noteDraftActive && !forceRefresh) {
    return;
  }
  const entries = selectedNoteEntries(session);
  const language = getLanguage();
  const previous = renderContexts.get(state);
  if (
    previous &&
    previous.chart === session.chart &&
    previous.lineIndex === session.lineIndex &&
    previous.tempo === tempo &&
    previous.division === session.division &&
    previous.multiLineActive === session.multiLineActive &&
    previous.multiLineMode === session.multiLineMode &&
    previous.language === language &&
    sameEntries(previous.entries, entries)
  ) {
    return;
  }
  renderContexts.set(state, {
    chart: session.chart,
    lineIndex: session.lineIndex,
    tempo,
    division: session.division,
    multiLineActive: session.multiLineActive,
    multiLineMode: session.multiLineMode,
    language,
    entries,
  });
  state.selectedCount.set(entries.length);
  const selectedEntry = entries[0];
  const selectedLineIndex = selectedEntry?.lineIndex ?? session.lineIndex;
  const note = selectedEntry?.note;
  const fields: NotePropertyField[] = [];

  if (note) {
    const above = t("editorPanels.inspector.direction.above");
    const below = t("editorPanels.inspector.direction.below");
    const noteTypeOptions = {
      1: t("editorPanels.inspector.noteType.tap"),
      2: t("editorPanels.inspector.noteType.hold"),
      3: t("editorPanels.inspector.noteType.flick"),
      4: t("editorPanels.inspector.noteType.drag"),
    };
    const directionOptions = note.type === 2 ? { 0: below, 1: above } : { 1: above, 2: below };
    const selectedLine = session.chart.judgeLineList?.[selectedLineIndex] ?? session.line;
    const selectedFactor = selectedLine?.bpmfactor ?? 1;
    const definitions: [FieldName, string, FieldKind, FieldOptions?][] = [
      ["type", t("editorPanels.inspector.field.type"), "select", noteTypeOptions],
      ["startTime", t("editorPanels.inspector.field.startTime"), "beat"],
      ["endTime", t("editorPanels.inspector.field.endTime"), "beat"],
      ["positionX", t("editorPanels.inspector.field.positionX"), "number"],
      ["above", t("editorPanels.inspector.field.above"), "select", directionOptions],
      ["isFake", t("editorPanels.inspector.field.isFake"), "boolean"],
      ["speed", t("editorPanels.inspector.field.speed"), "number", 1],
      ["size", t("editorPanels.inspector.field.size"), "number", 1],
      ["alpha", t("editorPanels.inspector.field.alpha"), "slider", 255],
      ["yOffset", t("editorPanels.inspector.field.yOffset"), "number", 0],
      ["visibleTime", t("editorPanels.inspector.field.visibleTime"), "duration", 999999],
      ["hitSound", t("editorPanels.inspector.field.hitSound"), "text"],
      ["color", t("editorPanels.inspector.field.color"), "color"],
    ];

    for (const [key, label, kind, options] of definitions) {
      const duration = key === "visibleTime";
      const step =
        key === "speed"
          ? 0.1
          : key === "size"
            ? 0.25
            : key === "positionX" || key === "yOffset"
              ? 5
              : 1;
      const focus = () => {
        session.noteDraftActive = true;
      };
      const blur = () => {
        session.noteDraftActive = false;
        queueMicrotask(() => {
          if (!session.noteDraftActive) {
            renderProperties(session, state, tempo, reportError, nudgeBeatInput);
          }
        });
      };
      if (kind === "beat") {
        const defaultBeat =
          key === "startTime"
            ? fromNumber(0)
            : note.type === 2
              ? addBeatFraction(note.startTime, 1, 1)
              : beatCopy(note.startTime);
        const commitBeat = (next: Beat) => {
          try {
            applyNoteTransform(
              session,
              t("editorPanels.inspector.modify", { field: label }),
              (current) => {
                if (key === "endTime") {
                  if (current.type !== 2 || compareBeats(next, current.startTime) < 0) {
                    throw new Error(t("editorPanels.inspector.endTimeHoldOnly"));
                  }
                  return { ...current, endTime: next };
                }
                // Moving a Hold's start keeps its duration exactly; every other
                // note stores its end at the same position as its start.
                return {
                  ...current,
                  startTime: next,
                  endTime:
                    current.type === 2
                      ? addBeats(next, subtractBeats(current.endTime, current.startTime))
                      : beatCopy(next),
                };
              },
            );
          } catch (error) {
            reportError(error);
          }
        };
        const disabled = key === "endTime" && note.type !== 2;
        fields.push({
          key,
          label,
          kind,
          value: "",
          preservesDraft: true,
          beat: note[key] as Beat,
          // A Hold's end must follow its start; a derived end is read-only.
          accepts:
            key === "endTime" ? (next) => compareBeats(next, note.startTime) >= 0 : undefined,
          disabled,
          // The runtime owns the division; a Hold's end never lands before its start.
          nudge: (next, direction) => {
            const moved = nudgeBeatInput(next, direction) ?? next;
            return key === "endTime" ? maxBeat(note.startTime, moved) : moved;
          },
          applyBeat: commitBeat,
          dirty: !disabled && compareBeats(note[key] as Beat, defaultBeat) !== 0,
          reset: disabled ? undefined : () => commitBeat(defaultBeat),
          focus,
          blur,
        });
        continue;
      }
      if (key === "color" || key === "hitSound") {
        const tinted = note as JudgeLineNote & { color?: unknown; tint?: unknown };
        const present = key === "color" ? noteHasColor(note) : noteHasHitSound(note);
        const apply = (control: PropertyControl) => {
          try {
            if (key === "color") {
              const color = parseColor(control.value);
              applyNoteTransform(
                session,
                t("editorPanels.inspector.modify", { field: label }),
                (current) => {
                  const next = { ...current };
                  if (color) {
                    next.color = color;
                  } else {
                    delete next.color;
                  }
                  delete (next as Record<string, unknown>).tint;
                  return next;
                },
              );
              return;
            }
            const hitSound = control.value.trim();
            applyNoteTransform(
              session,
              t("editorPanels.inspector.modify", { field: label }),
              (current) => {
                const next = { ...current, hitSound: hitSound || undefined };
                delete (next as Record<string, unknown>).hitsound;
                return next;
              },
            );
          } catch (error) {
            reportError(error);
            control.value =
              key === "color"
                ? colorHex(tinted.color ?? tinted.tint)
                : String(note.hitSound ?? note.hitsound ?? "");
          }
        };
        fields.push({
          key,
          label,
          kind: key === "color" ? "color" : "text",
          preservesDraft: key === "hitSound",
          value:
            key === "color"
              ? colorHex(tinted.color ?? tinted.tint)
              : String(note.hitSound ?? note.hitsound ?? ""),
          present,
          placeholder:
            key === "color" ? "#RRGGBB" : t("editorPanels.inspector.hitSoundPlaceholder"),
          dirty: present,
          reset: () => apply({ value: "" }),
          apply,
          focus,
          blur,
        });
        continue;
      }
      let value = String(note[key] ?? (typeof options === "number" ? options : 0));
      if (key === "isFake") {
        value = Number(note.isFake ?? 0) === 1 ? "1" : "0";
      }
      if (key === "above") {
        value = String(noteIsAbove(note) ? 1 : note.type === 2 ? 0 : 2);
      }
      // Visible time is always seconds: display and parse share the chart's unit.
      const apply = (control: PropertyControl) => {
        try {
          const numberValue = Number(control.value);
          if (control.value.trim() === "" || !Number.isFinite(numberValue)) {
            throw new Error(t("editorPanels.inspector.finiteNumber"));
          }
          if (key === "size" && numberValue <= 0) {
            throw new Error(t("editorPanels.inspector.sizePositive"));
          }
          applyNoteTransform(
            session,
            t("editorPanels.inspector.modify", { field: label }),
            (current) => {
              const next = {
                ...current,
                [key]: duration ? Math.max(0, numberValue) : numberValue,
              };
              if (key === "above") {
                next.above = numberValue === 1 ? 1 : current.type === 2 ? 0 : 2;
              }
              if (key === "type") {
                next.endTime =
                  numberValue === 2
                    ? maxBeat(current.endTime, addBeatFraction(current.startTime, 1, 1))
                    : beatCopy(current.startTime);
                next.above = noteIsAbove(current) ? 1 : numberValue === 2 ? 0 : 2;
              }
              return next;
            },
          );
          if (key === "type") {
            // Type changes alter which fields are editable while the select keeps focus.
            renderProperties(session, state, tempo, reportError, nudgeBeatInput, true);
          }
        } catch (error) {
          reportError(error);
          control.value = String(note[key] ?? 0);
        }
      };
      const optional =
        key === "speed" ||
        key === "size" ||
        key === "alpha" ||
        key === "yOffset" ||
        key === "visibleTime";
      const preservesDraft = kind === "number" || kind === "duration" || kind === "text";
      const present =
        key === "isFake"
          ? Number(note.isFake ?? 0) === 1
          : key === "speed"
            ? noteHasCustomSpeed(note)
            : key === "size"
              ? noteHasCustomSize(note)
              : key === "alpha"
                ? noteHasCustomAlpha(note)
                : key === "yOffset"
                  ? noteHasCustomYOffset(note)
                  : key === "visibleTime"
                    ? noteHasCustomVisibleTime(note)
                    : false;
      const dirty =
        optional || key === "isFake"
          ? present
          : key === "type"
            ? note.type !== 1
            : key === "positionX"
              ? Number(note.positionX ?? 0) !== 0
              : key === "above"
                ? !noteIsAbove(note)
                : false;
      const defaultText =
        key === "type" ? "1" : key === "positionX" ? "0" : key === "above" ? "1" : "0";
      const reset = optional
        ? () => {
            try {
              applyNoteTransform(
                session,
                t("editorPanels.inspector.modify", { field: label }),
                (current) => {
                  const next = { ...current };
                  delete (next as Record<string, unknown>)[key];
                  return next;
                },
              );
            } catch (error) {
              reportError(error);
            }
          }
        : () => apply({ value: defaultText });
      fields.push({
        key,
        label,
        kind,
        preservesDraft,
        value,
        options:
          kind === "select" ? Object.entries((options ?? {}) as Record<string, string>) : undefined,
        step: kind === "number" || kind === "slider" ? step : undefined,
        min: key === "size" ? String(0.01) : key === "alpha" || duration ? String(0) : undefined,
        max: key === "alpha" ? String(255) : undefined,
        present,
        dirty,
        reset,
        apply,
        focus,
        blur,
        wheel: duration
          ? (direction) => {
              const current = selectedNoteEntries(session)[0]?.note;
              if (!current) {
                return null;
              }
              const factor =
                session.chart.judgeLineList?.[selectedLineIndex]?.bpmfactor ?? selectedFactor;
              const visible = current.visibleTime;
              const beats =
                visible !== undefined && visible >= 999999
                  ? 0
                  : Math.max(
                      0,
                      visibleBeats(current, tempo, factor) + direction / session.division,
                    );
              const value = String(
                Number(visibleSeconds(current, beats, tempo, factor).toFixed(8)),
              );
              const control = { value };
              apply(control);
              return control.value;
            }
          : undefined,
      });
    }
  }

  state.properties.set({
    revision: ++revision,
    fields,
    empty: !note,
    emptyHint: t("editorPanels.inspector.emptyHint"),
  });
}
