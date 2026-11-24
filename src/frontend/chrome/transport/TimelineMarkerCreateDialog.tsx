/**
 * Creates one timeline marker from the beat selected by the timeline menu.
 *
 * The modal owns only the short-lived name and colour drafts. The editor
 * session remains the source of truth and receives one normal chart commit
 * when the user confirms the form.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  addTimelineMarker,
  createTimelineMarkerId,
  normalizeMarkerColor,
  readTimelineMarkers,
  writeTimelineMarkers,
  type TimelineMarker,
} from "../../../core/global/chart/timelineMarkers.ts";
import { Button } from "../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { ColorField } from "../../../design/components/input/ColorField.tsx";
import { Modal } from "../../../design/components/modal/Modal.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import { useEditorHostRuntime } from "../../contracts/editorHostReact.tsx";
import { closeMarkerDialog, getMarkerDialog, subscribeMarkerDialog } from "./markerDialogs.ts";

/** Dark-theme marker colour, used when the active warning token is not hex. */
const FALLBACK_MARKER_COLOR = "#ffcc66";

/** Read the warning token as a colour input value. */
function defaultMarkerColor(): string {
  const root = globalThis.document?.documentElement;
  const value = root ? getComputedStyle(root).getPropertyValue("--warning").trim() : "";
  return normalizeMarkerColor(value) ?? FALLBACK_MARKER_COLOR;
}

/** The mounted create dialog, or nothing while another marker dialog is open. */
export function TimelineMarkerCreateDialog() {
  const dialog = useSyncExternalStore(subscribeMarkerDialog, getMarkerDialog, getMarkerDialog);
  if (dialog?.kind !== "create") {
    return null;
  }
  return <CreateMarkerDialog beat={dialog.beat ?? 0} onClose={closeMarkerDialog} />;
}

/** The editable form for one marker at a fixed chart beat. */
function CreateMarkerDialog({ beat, onClose }: { beat: number; onClose(): void }) {
  const { t } = useTranslation();
  const runtime = useEditorHostRuntime();
  const nameId = useId();
  const colorId = useId();
  const nameField = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(() =>
    t("chrome.transport.markerManager.defaultName", {
      index: (runtime ? readTimelineMarkers(runtime.session.chart).length : 0) + 1,
    }),
  );
  const [color, setColor] = useState(defaultMarkerColor);
  const [error, setError] = useState("");

  useEffect(() => {
    nameField.current?.focus();
  }, []);

  /** Validate the drafts and append one marker through the normal history path. */
  const submit = () => {
    const session = runtime?.session;
    if (!runtime || !session?.editable) {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("chrome.transport.markerManager.invalidName"));
      nameField.current?.focus();
      return;
    }
    const current = readTimelineMarkers(session.chart, runtime.timeline.viewport.tempo);
    const position = Math.max(0, Number.isFinite(beat) ? Number(beat.toFixed(3)) : 0);
    const marker: TimelineMarker = {
      id: createTimelineMarkerId(),
      beat: position,
      name: trimmed,
      color,
    };
    const next = addTimelineMarker(current, marker);
    if (
      session.commitChart(
        t("workspace.dialogs.addMarker"),
        writeTimelineMarkers(session.chart, next),
        session.selectionState(),
        undefined,
        { normalized: true },
      )
    ) {
      onClose();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      label={t("workspace.dialogs.addMarker")}
      className="timeline-marker-create-dialog"
      actions={
        <>
          <Button type="button" variant="outlined" onClick={onClose}>
            {t("common.action.cancel")}
          </Button>
          <Button type="button" variant="solid" onClick={submit}>
            {t("common.action.confirm")}
          </Button>
        </>
      }
    >
      <div className="timeline-marker-create-form">
        <FieldRow
          layout="inline"
          htmlFor={nameId}
          label={t("chrome.transport.markerManager.name")}
          error={error}
          control={
            <Input
              id={nameId}
              ref={nameField}
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.currentTarget.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
          }
        />
        <FieldRow
          layout="inline"
          htmlFor={colorId}
          label={t("chrome.transport.markerManager.color")}
          control={<ColorField id={colorId} value={color} onChange={(value) => setColor(value)} />}
        />
      </div>
    </Modal>
  );
}
