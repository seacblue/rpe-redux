/**
 * Hosts the multi-edit mode switch and the two mode-specific forms.
 *
 * Both forms stay mounted so switching modes keeps each draft's local field
 * state; the switch only changes which face is visible and which handle the
 * panel reads. The panel still owns planning, history, and commit.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../../../../../design/components/segmented/Segmented.tsx";
import { t } from "../../../../../i18n/index.ts";
import {
  defaultBatchParameters,
  type BatchParameters,
  type CloneParameters,
  type MultiEditKind,
} from "../../../../../core/edit/multiEdit/parameters.ts";
import {
  MultiEditForm,
  type MultiEditFormHandle,
  type MultiEditFormValues,
} from "./MultiEditForm.tsx";
import { EventCloneForm, type EventCloneFormHandle } from "./EventCloneForm.tsx";

/** The two faces of the event multi-edit pane. */
export type MultiEditMode = "edit" | "clone";

/** The unified handle the panel drives regardless of the active mode. */
export interface MultiEditPaneHandle {
  read(): MultiEditFormValues | CloneParameters;
  load(
    value: MultiEditFormValues | Partial<CloneParameters>,
    options?: { preserveCurrent?: boolean },
  ): void;
  setEventTypes(eventTypes: readonly string[]): void;
  selectHistory(value: string): void;
  setResult(message: string, error: boolean): void;
  setReady(ready: boolean): void;
  setWarning(warning: string): void;
  isPreviewEnabled(): boolean;
}

interface MultiEditPaneProps {
  kind: MultiEditKind;
  multiEventEdit: boolean;
  noiseActivation: boolean;
  eventTypes: readonly string[];
  editHistory: BatchParameters[];
  cloneHistory: CloneParameters[];
  cloneValues: CloneParameters;
  defaultCloneTargets: string;
  onReady(handle: MultiEditPaneHandle): void;
  onChange(value: MultiEditFormValues | CloneParameters): void;
  onHistory(index: number, mode: MultiEditMode): void;
  onApply(): void;
  onModeChange(mode: MultiEditMode): void;
}

/** Renders the mode switch and keeps both form drafts alive. */
export function MultiEditPane({
  kind,
  multiEventEdit,
  noiseActivation,
  eventTypes,
  editHistory,
  cloneHistory,
  cloneValues,
  defaultCloneTargets,
  onReady,
  onChange,
  onHistory,
  onApply,
  onModeChange,
}: MultiEditPaneProps) {
  const [mode, setMode] = useState<MultiEditMode>("edit");
  const editHandle = useRef<MultiEditFormHandle | null>(null);
  const cloneHandle = useRef<EventCloneFormHandle | null>(null);
  const announcedMode = useRef<MultiEditMode>("edit");
  const fallbackEditValues = useMemo<MultiEditFormValues>(
    () => ({
      mode: "edit",
      ...defaultBatchParameters(kind),
      ...(noiseActivation ? { field: "t1" } : {}),
      eventApplicationMode: "per-line",
      eventType: eventTypes[0] ?? "",
    }),
    [kind, noiseActivation, eventTypes],
  );

  const handle = useMemo<MultiEditPaneHandle>(
    () => ({
      read: () => {
        if (mode === "clone") {
          return cloneHandle.current?.read() ?? cloneValues;
        }
        return editHandle.current?.read() ?? fallbackEditValues;
      },
      load: (value, options) => {
        if ((value as Partial<CloneParameters>).mode === "clone") {
          if (mode !== "clone") {
            setMode("clone");
          }
          cloneHandle.current?.load(value as Partial<CloneParameters>, options);
          return;
        }
        if (mode !== "edit") {
          setMode("edit");
        }
        editHandle.current?.load(value as Partial<MultiEditFormValues>, options);
      },
      setEventTypes: (types) => {
        editHandle.current?.setEventTypes(types);
        cloneHandle.current?.setEventTypes(types);
      },
      selectHistory: (value) => {
        if (mode === "clone") {
          cloneHandle.current?.selectHistory(value);
        } else {
          editHandle.current?.selectHistory(value);
        }
      },
      setResult: (message, error) => {
        if (mode === "clone") {
          cloneHandle.current?.setResult(message, error);
        } else {
          editHandle.current?.setResult(message, error);
        }
      },
      setReady: (ready) => cloneHandle.current?.setReady(ready),
      setWarning: (warning) => cloneHandle.current?.setWarning(warning),
      isPreviewEnabled: () =>
        mode === "clone"
          ? (cloneHandle.current?.isPreviewEnabled() ?? false)
          : (editHandle.current?.isPreviewEnabled() ?? false),
    }),
    [mode, cloneValues, fallbackEditValues],
  );
  useLayoutEffect(() => onReady(handle), [handle, onReady]);
  useEffect(() => {
    if (announcedMode.current === mode) {
      return;
    }
    announcedMode.current = mode;
    onModeChange(mode);
  }, [mode, onModeChange]);

  return (
    <div className="multi-edit-pane">
      {kind === "events" && (
        <Segmented
          className="multi-edit-mode"
          ariaLabel={t("editorPanels.multiEdit.mode")}
          value={mode}
          options={[
            { value: "edit", label: t("editorPanels.multiEdit.mode.edit") },
            { value: "clone", label: t("editorPanels.multiEdit.mode.clone") },
          ]}
          onChange={(next) => setMode(next)}
        />
      )}
      <div hidden={mode !== "edit"}>
        <MultiEditForm
          kind={kind}
          noiseActivation={noiseActivation}
          eventTypes={eventTypes}
          multiEventEdit={multiEventEdit}
          history={editHistory}
          onReady={(next) => {
            editHandle.current = next;
          }}
          onChange={(value) => onChange(value)}
          onHistory={(index) => onHistory(index, "edit")}
          onApply={onApply}
        />
      </div>
      {kind === "events" && (
        <div hidden={mode !== "clone"}>
          <EventCloneForm
            initialValues={cloneValues}
            defaultTargets={defaultCloneTargets}
            eventTypes={eventTypes}
            history={cloneHistory}
            onReady={(next) => {
              cloneHandle.current = next;
            }}
            onChange={(value) => onChange(value)}
            onHistory={(index) => onHistory(index, "clone")}
            onApply={onApply}
          />
        </div>
      )}
    </div>
  );
}
