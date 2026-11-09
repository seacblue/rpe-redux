/**
 * The time-marker manager dialog.
 *
 * It edits the current chart's marker list: add one at the playhead, then
 * rename, retime, recolour, or delete it. Every change goes through the
 * session's normal chart commit so undo and collaboration see one edit.
 */
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { ColorField } from "../../../design/components/input/ColorField.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { ListRow } from "../../../design/components/list/ListRow.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import {
  addTimelineMarker,
  createTimelineMarkerId,
  normalizeMarkerColor,
  readTimelineMarkers,
  removeTimelineMarker,
  updateTimelineMarker,
  writeTimelineMarkers,
  type TimelineMarker,
  type TimelineMarkerPatch,
} from "../../../core/global/chart/timelineMarkers.ts";
import { useTranslation } from "../../../i18n/react.ts";
import { useEditorHostRuntime, useEditorHostValue } from "../../contracts/editorHostReact.tsx";
import { closeMarkerDialog, getMarkerDialog, subscribeMarkerDialog } from "./markerDialogs.ts";

/** Dark-theme marker colour, used when the active theme's warning is not a hex value. */
const FALLBACK_MARKER_COLOR = "#ffcc66";

/** The theme's marker colour, read from the same token the marker strip uses. */
function defaultMarkerColor(): string {
  const root = globalThis.document?.documentElement;
  const value = root ? getComputedStyle(root).getPropertyValue("--warning").trim() : "";
  return normalizeMarkerColor(value) ?? FALLBACK_MARKER_COLOR;
}

type MarkerRowError = "invalidName" | "invalidTime" | null;

/** One row's local drafts, tied to the marker values they were read from. */
interface MarkerDraft {
  source: string;
  name: string;
  time: string;
  error: MarkerRowError;
}

/** Marker values and callbacks one row edits. */
interface MarkerRowProps {
  marker: TimelineMarker;
  selected: boolean;
  fallbackColor: string;
  onSelect(): void;
  onEdit(patch: TimelineMarkerPatch): boolean;
}

/** One marker row with drafts that commit on blur or Enter. */
function MarkerRow({ marker, selected, fallbackColor, onSelect, onEdit }: MarkerRowProps) {
  const { t } = useTranslation();
  const fieldId = useId();
  const colorId = `${fieldId}-color`;
  const nameId = `${fieldId}-name`;
  const timeId = `${fieldId}-time`;
  const source = `${marker.time}\u0000${marker.name}`;
  const [draft, setDraft] = useState<MarkerDraft>(() => ({
    source,
    name: marker.name,
    time: String(marker.time),
    error: null,
  }));
  // An external edit, undo, or reorder replaces the marker under this row. The
  // current draft is derived from the new values before state catches up, so
  // the inputs never paint one render of the previous marker.
  const current: MarkerDraft =
    draft.source === source
      ? draft
      : { source, name: marker.name, time: String(marker.time), error: null };
  if (draft.source !== source) {
    setDraft(current);
  }

  /** Commit the trimmed name, or restore the stored one and explain why. */
  const commitName = () => {
    const trimmed = current.name.trim();
    if (!trimmed) {
      setDraft({ ...current, name: marker.name, error: "invalidName" });
      return;
    }
    if (trimmed === marker.name) {
      setDraft({ ...current, error: null });
      return;
    }
    if (!onEdit({ name: trimmed })) {
      setDraft({ ...current, name: marker.name, error: null });
    } else {
      setDraft({ ...current, error: null });
    }
  };

  /** Commit a finite, non-negative second value, or restore the stored one. */
  const commitTime = () => {
    const raw = current.time.trim();
    const parsed = Number(raw);
    if (raw === "" || !Number.isFinite(parsed) || parsed < 0) {
      setDraft({ ...current, time: String(marker.time), error: "invalidTime" });
      return;
    }
    if (parsed === marker.time) {
      setDraft({ ...current, error: null });
      return;
    }
    if (!onEdit({ time: parsed })) {
      setDraft({ ...current, time: String(marker.time), error: null });
    } else {
      setDraft({ ...current, error: null });
    }
  };

  const errorText =
    current.error === "invalidName"
      ? t("chrome.transport.markerManager.invalidName")
      : current.error === "invalidTime"
        ? t("chrome.transport.markerManager.invalidTime")
        : "";

  return (
    <ListRow
      className="marker-manager-row"
      selected={selected}
      onClick={onSelect}
      onFocus={onSelect}
    >
      <span className="marker-manager-color">
        <label className="redux-visually-hidden" htmlFor={colorId}>
          {t("chrome.transport.markerManager.color")}
        </label>
        <ColorField
          id={colorId}
          value={marker.color ?? fallbackColor}
          onChange={(color) => onEdit({ color })}
        />
      </span>
      <label className="redux-visually-hidden" htmlFor={nameId}>
        {t("chrome.transport.markerManager.name")}
      </label>
      <Input
        id={nameId}
        type="text"
        textAlign="left"
        value={current.name}
        onChange={(event) => {
          const name = event.currentTarget.value;
          setDraft({ ...current, name });
        }}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.currentTarget.value = marker.name;
            setDraft({ ...current, name: marker.name, error: null });
          }
        }}
      />
      <label className="redux-visually-hidden" htmlFor={timeId}>
        {t("chrome.transport.markerManager.time")}
      </label>
      <Input
        id={timeId}
        type="number"
        min="0"
        step="any"
        value={current.time}
        onChange={(event) => {
          const time = event.currentTarget.value;
          setDraft({ ...current, time });
        }}
        onBlur={commitTime}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.currentTarget.value = String(marker.time);
            setDraft({ ...current, time: String(marker.time), error: null });
          }
        }}
      />
      {errorText && (
        <span className="marker-manager-row-error" role="alert">
          {errorText}
        </span>
      )}
    </ListRow>
  );
}

/** The marker manager modal, opened from the progress card's marker menu. */
export function MarkerManagerDialog() {
  const runtime = useEditorHostRuntime();
  const session = runtime?.session ?? null;
  const { t } = useTranslation();
  const dialog = useSyncExternalStore(subscribeMarkerDialog, getMarkerDialog, getMarkerDialog);
  const open = dialog === "manager";
  // The controller republishes this snapshot after a chart commit, so an undo
  // or a peer's edit reaches the open dialog without a second session store.
  useEditorHostValue((editor) => editor.ui.timelineMarkers.snapshot, null);
  const markers = session ? readTimelineMarkers(session.chart) : [];
  const markerCount = markers.length;
  const [selection, setSelection] = useState<number | null>(null);
  // A peer edit or an undo can shrink the list under the stored index; the
  // display clamps it instead of writing the derived value back through state.
  const selectedIndex =
    selection !== null && markerCount > 0 ? Math.min(selection, markerCount - 1) : null;

  /** Commit one normalized marker array through the session history. */
  const commit = (label: string, next: readonly TimelineMarker[]): boolean => {
    if (!session) {
      return false;
    }
    return session.commitChart(
      label,
      writeTimelineMarkers(session.chart, next),
      session.selectionState(),
      undefined,
      { normalized: true },
    );
  };

  /** Replace one marker by id and commit the edit, following a marker that moved. */
  const edit = (index: number, patch: TimelineMarkerPatch): boolean => {
    const target = markers[index];
    if (!session || !target?.id) {
      return false;
    }
    const targetId = target.id;
    const current = readTimelineMarkers(session.chart);
    if (!current.some((entry) => entry.id === targetId)) {
      return false;
    }
    const next = updateTimelineMarker(current, targetId, patch);
    if (!commit(t("workspace.dialogs.editMarker"), next)) {
      return false;
    }
    if (patch.time !== undefined) {
      const moved = next.findIndex((entry) => entry.id === targetId);
      if (moved >= 0) {
        setSelection(moved);
      }
    }
    return true;
  };

  /** Add a marker named for its ordinal at the current chart playhead. */
  const add = () => {
    if (!runtime || !session) {
      return;
    }
    const current = readTimelineMarkers(session.chart);
    const offsetSeconds = Number(session.chart.META.offset ?? 0) / 1000;
    const playhead = Number(runtime.audio.time);
    const time = Number.isFinite(playhead) ? Math.max(0, playhead - offsetSeconds) : 0;
    const marker: TimelineMarker = {
      id: createTimelineMarkerId(),
      time,
      name: t("chrome.transport.markerManager.defaultName", { index: current.length + 1 }),
    };
    const next = addTimelineMarker(current, marker);
    if (!commit(t("workspace.dialogs.addMarker"), next)) {
      return;
    }
    const added = next.findIndex((entry) => entry.id === marker.id);
    setSelection(added >= 0 ? added : null);
  };

  /** Delete the selected row by id and keep the selection on the nearest remaining row. */
  const remove = () => {
    if (!session || selectedIndex === null) {
      return;
    }
    const target = markers[selectedIndex];
    if (!target?.id) {
      return;
    }
    const current = readTimelineMarkers(session.chart);
    const live = current.findIndex((entry) => entry.id === target.id);
    if (live < 0) {
      setSelection(current.length ? Math.min(selectedIndex, current.length - 1) : null);
      return;
    }
    const next = removeTimelineMarker(current, target.id);
    if (!commit(t("workspace.dialogs.deleteMarker"), next)) {
      return;
    }
    setSelection(next.length ? Math.min(live, next.length - 1) : null);
  };

  const fallbackColor = defaultMarkerColor();

  return (
    <Modal
      open={open}
      onClose={closeMarkerDialog}
      label={t("chrome.transport.markerManager.title")}
      className="marker-manager-dialog"
      actions={
        <>
          <Button
            type="button"
            variant="danger"
            disabled={selectedIndex === null || !session}
            onClick={remove}
          >
            {t("common.action.delete")}
          </Button>
          <Button type="button" variant="solid" onClick={closeMarkerDialog}>
            {t("common.action.close")}
          </Button>
        </>
      }
    >
      <div className="marker-manager">
        <div className="marker-manager-toolbar">
          <Button type="button" variant="outlined" size="sm" disabled={!session} onClick={add}>
            {t("chrome.transport.markerManager.add")}
          </Button>
        </div>
        {markerCount === 0 ? (
          <p className="marker-manager-empty">{t("chrome.transport.markerManager.empty")}</p>
        ) : (
          <>
            <div className="marker-manager-head" aria-hidden="true">
              <span>{t("chrome.transport.markerManager.color")}</span>
              <span>{t("chrome.transport.markerManager.name")}</span>
              <span>{t("chrome.transport.markerManager.time")}</span>
            </div>
            <div className="marker-manager-list">
              {/* The id keeps a row mounted while a commit reorders the list,
                  and the row derives fresh drafts when its marker prop changes. */}
              {markers.map((marker, index) => (
                <MarkerRow
                  key={marker.id ?? index}
                  marker={marker}
                  selected={selectedIndex === index}
                  fallbackColor={fallbackColor}
                  onSelect={() => setSelection(index)}
                  onEdit={(patch) => edit(index, patch)}
                />
              ))}
            </div>
            {selectedIndex === null && (
              <p className="marker-manager-hint">
                {t("chrome.transport.markerManager.selectFirst")}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
