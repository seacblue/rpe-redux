/**
 * The batch-edit form: operation, target fields, and their parameters.
 *
 * It exposes an imperative handle that the panel model drives, because the same
 * element is created outside this component's tree. Field state and validation
 * messages stay local to the form.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { FieldReset } from "../../../../../design/components/field/FieldReset.tsx";
import { SchemaControl } from "../../../../../design/components/field/SchemaControl.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { EasingField } from "../../../../../design/components/easing/EasingField.tsx";
import { t, type MessageKey } from "../../../../../i18n/index.ts";
import { formatBeat, parseBeat, type Beat } from "../../../../../core/global/chart/timing/beat.ts";
import { EVENT_TRACKS } from "../../../../../core/global/chart/chartVocabulary.ts";
import { NOISE_ACTIVE_EVENTS } from "../../../../../core/edit/events/eventTracks.ts";
import {
  BATCH_OPERATIONS,
  NOTE_BATCH_FIELDS,
  EVENT_BATCH_FIELDS,
} from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import {
  defaultBatchParameters,
  type BatchParameters,
  type MultiEditKind,
} from "../../../../../core/edit/multiEdit/parameters.ts";
import { useEditingFeature } from "../../../settings/editingCapabilities.ts";
import { BeatField } from "../beat/BeatField.tsx";

type Option = readonly [string | number, string];

/** Stable event-track order used by the multi-edit type selector. */
const MULTI_EDIT_EVENT_TYPES: readonly string[] = [...EVENT_TRACKS, NOISE_ACTIVE_EVENTS];

export type MultiEditFormValues = BatchParameters & {
  eventApplicationMode: string;
  eventType: string;
};

export interface MultiEditFormHandle {
  read(): MultiEditFormValues;
  load(value: Partial<MultiEditFormValues>, options?: { preserveCurrent?: boolean }): void;
  setEventTypes(eventTypes: readonly string[]): void;
  selectHistory(value: string): void;
  setResult(message: string, error: boolean): void;
  isPreviewEnabled(): boolean;
}

interface MultiEditFormProps {
  kind: MultiEditKind;
  multiEventEdit: boolean;
  noiseActivation: boolean;
  eventTypes: readonly string[];
  history: BatchParameters[];
  onReady(handle: MultiEditFormHandle): void;
  onChange(value: MultiEditFormValues): void;
  onHistory(index: number): void;
  onApply(): void;
}

/**
 * Vocabulary labels combine a symbol with its localized meaning; the inspector
 * only has room for the symbol.
 */
function shortLabel(label: string): string {
  return label.split(/[·,，、]/u)[0]?.trim() || label;
}

const EVENT_TYPE_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  rotateEvents: "editorPanels.timeline.track.rotation",
  alphaEvents: "editorPanels.timeline.track.opacity",
  speedEvents: "editorPanels.timeline.track.speed",
  scaleXEvents: "editor.display.editorDisplay.trackScaleX",
  scaleYEvents: "editor.display.editorDisplay.trackScaleY",
  colorEvents: "editor.display.editorDisplay.trackColor",
  paintEvents: "editor.display.editorDisplay.trackShader",
  textEvents: "editor.display.editorDisplay.trackText",
  inclineEvents: "editorPanels.issues.trackIncline",
  gifEvents: "editorPanels.issues.trackGif",
};

/** Resolves a chart event track to the compact label used by the inspector. */
function eventTypeLabel(type: string): string {
  if (type === "moveXEvents") {
    return "X";
  }
  if (type === "moveYEvents") {
    return "Y";
  }
  if (type === NOISE_ACTIVE_EVENTS) {
    return t("editorPanels.linePanel.noiseActive");
  }
  const key = EVENT_TYPE_LABEL_KEYS[type];
  return key ? t(key) : type;
}

/** Converts a persisted batch bound to a BeatField value, falling back to zero. */
function batchBeat(value: string | number): Beat {
  try {
    return parseBeat(value);
  } catch {
    return [0, 0, 1];
  }
}

/** Renders one labeled input or select for a batch parameter. */
function Field({
  title,
  value,
  options,
  type = "text",
  beat,
  onChange,
}: {
  title: string;
  value: string | number;
  options?: readonly Option[];
  type?: string;
  beat?: Beat;
  onChange(value: string): void;
}) {
  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={title}
      control={(id) =>
        options ? (
          <SchemaControl
            id={id}
            kind="select"
            value={String(value)}
            options={options.map(([key, label]) => ({ value: String(key), label }))}
            onChange={(next) => onChange(String(next))}
          />
        ) : beat ? (
          <BeatField
            id={id}
            value={beat}
            onCommit={(next) => {
              onChange(formatBeat(next));
              return true;
            }}
            dataField={title}
          />
        ) : (
          <SchemaControl
            id={id}
            kind={type === "number" ? "number" : "text"}
            value={String(value)}
            onChange={(next) => onChange(String(next))}
          />
        )
      }
    />
  );
}

/** Renders the batch form and exposes its imperative handle to the panel. */
export function MultiEditForm({
  kind,
  multiEventEdit,
  noiseActivation,
  eventTypes,
  history,
  onReady,
  onChange,
  onHistory,
  onApply,
}: MultiEditFormProps) {
  const linkgroupEnabled = useEditingFeature("linkgroup");
  const noteSpeedEnabled = useEditingFeature("noteSpeed");
  const noteSizeEnabled = useEditingFeature("noteSize");
  const noteAlphaEnabled = useEditingFeature("noteAlpha");
  const noteYOffsetEnabled = useEditingFeature("noteYOffset");
  const noteVisibleTimeEnabled = useEditingFeature("noteVisibleTime");
  const noteColorEnabled = useEditingFeature("noteColor");
  const noteHitSoundEnabled = useEditingFeature("noteHitSound");
  const [values, setValues] = useState<MultiEditFormValues>(() => ({
    ...defaultBatchParameters(kind),
    ...(noiseActivation ? { field: "t1" } : {}),
    eventApplicationMode: "per-line",
    eventType: eventTypes[0] ?? "",
  }));
  const [historySelection, setHistorySelection] = useState("");
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [resultError, setResultError] = useState(false);
  const currentValues = useRef(values);
  const update = (next: Partial<MultiEditFormValues>) => {
    const value = { ...values, ...next } as MultiEditFormValues;
    setValues(value);
    currentValues.current = value;
    // A field change diverges from the loaded history entry, so its marker clears.
    setHistorySelection("");
    onChange(value);
  };
  const handle = useMemo<MultiEditFormHandle>(
    () => ({
      read: () => values,
      load: (next, options) => {
        const value = {
          ...defaultBatchParameters(kind),
          eventApplicationMode: "per-line",
          eventType: eventTypes[0] ?? "",
          ...next,
        } as MultiEditFormValues;
        if (kind === "events" && !EVENT_BATCH_FIELDS.some(([key]) => key === value.field)) {
          value.field = "both";
        }
        if (noiseActivation && !["t1", "t2"].includes(value.field)) {
          value.field = "t1";
        }
        setValues(value);
        if (!options?.preserveCurrent) {
          currentValues.current = value;
        }
      },
      setEventTypes: (nextTypes) => {
        const uniqueTypes = [...new Set(nextTypes)];
        const eventType = uniqueTypes[0] ?? "";
        if (values.eventType === eventType) {
          return;
        }
        const value = { ...values, eventType } as MultiEditFormValues;
        setValues(value);
        currentValues.current = value;
        setHistorySelection("");
        onChange(value);
      },
      selectHistory: setHistorySelection,
      setResult: (message, error) => {
        setResultMessage(message);
        setResultError(error);
      },
      isPreviewEnabled: () => previewEnabled,
    }),
    [values, previewEnabled, kind, noiseActivation, eventTypes, onChange],
  );
  useLayoutEffect(() => onReady(handle), [handle, onReady]);

  const noteFieldsEnabled: Record<string, boolean> = {
    speed: noteSpeedEnabled,
    size: noteSizeEnabled,
    alpha: noteAlphaEnabled,
    yOffset: noteYOffsetEnabled,
    visibleTime: noteVisibleTimeEnabled,
    red: noteColorEnabled,
    green: noteColorEnabled,
    blue: noteColorEnabled,
    hitSound: noteHitSoundEnabled,
  };
  const fields: readonly Option[] = (
    kind === "notes"
      ? NOTE_BATCH_FIELDS.filter(([key]) => noteFieldsEnabled[key] ?? true)
      : EVENT_BATCH_FIELDS.filter(([key]) =>
          noiseActivation ? ["t1", "t2"].includes(key) : key !== "linkgroup" || linkgroupEnabled,
        )
  ).map(([key, label]) => [key, shortLabel(label)] as const);
  const eventTypeOptions: readonly Option[] = MULTI_EDIT_EVENT_TYPES.map((type) => [
    type,
    eventTypeLabel(type),
  ]);
  const operations = BATCH_OPERATIONS.map(([key, label]) => [key, shortLabel(label)] as const);
  const beatBounds = kind === "events" && (values.field === "t1" || values.field === "t2");
  const historyIndex = Number(historySelection);
  const selectedHistoryIndex =
    Number.isInteger(historyIndex) && historyIndex >= 0 && historyIndex < history.length
      ? historyIndex
      : history.length - 1;
  const currentIndex = history.length;
  const activeIndex = historySelection === "" ? currentIndex : selectedHistoryIndex;
  const historyPosition = activeIndex + 1;
  const canLoadPrevious = activeIndex > 0;
  const canLoadNext = activeIndex < currentIndex;
  const loadHistory = (index: number) => {
    if (index < 0 || index > currentIndex) {
      return;
    }
    if (index === currentIndex) {
      const value = currentValues.current;
      setValues(value);
      setHistorySelection("");
      onChange(value);
      return;
    }
    setHistorySelection(String(index));
    onHistory(index);
  };
  return (
    <div className="multi-edit-form">
      {noiseActivation && <p className="hint">{t("editorPanels.linePanel.noiseActiveHint")}</p>}
      <FieldRows>
        {kind === "events" && (
          <Field
            title={t("editorPanels.multiEdit.eventType")}
            value={values.eventType}
            options={eventTypeOptions}
            onChange={(eventType) => update({ eventType })}
          />
        )}
        <Field
          title={t("editorPanels.multiEdit.field")}
          value={values.field}
          options={fields}
          onChange={(field) => update({ field })}
        />
        <Field
          title={t("editorPanels.multiEdit.operation")}
          value={values.operation}
          options={operations}
          onChange={(operation) => update({ operation })}
        />
        <Field
          title={t("editorPanels.multiEdit.distribution.lower")}
          value={values.lower}
          beat={beatBounds ? batchBeat(values.lower) : undefined}
          onChange={(lower) => update({ lower })}
        />
        <Field
          title={t("editorPanels.multiEdit.distribution.upper")}
          value={values.upper}
          beat={beatBounds ? batchBeat(values.upper) : undefined}
          onChange={(upper) => update({ upper })}
        />
        <EasingField
          label={t("editorPanels.multiEdit.distribution.easingType")}
          value={Number(values.easingType) || 1}
          onChange={(easingType) => update({ easingType })}
        />
        <Field
          title={t("editorPanels.multiEdit.distribution.cycle")}
          value={values.cycle}
          onChange={(cycle) => update({ cycle })}
        />
        <Field
          title={t("editorPanels.multiEdit.distribution.disturbance")}
          value={values.disturbance}
          onChange={(disturbance) => update({ disturbance })}
        />
        {multiEventEdit && (
          <Field
            title={t("editorPanels.multiEdit.applicationMode")}
            value={values.eventApplicationMode ?? "per-line"}
            options={[
              ["per-line", t("editorPanels.multiEdit.applicationMode.perLine")],
              ["global", t("editorPanels.multiEdit.applicationMode.global")],
            ]}
            onChange={(eventApplicationMode) => update({ eventApplicationMode })}
          />
        )}
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.multiEdit.previewToggle")}
          reset={
            <FieldReset
              field="result-ghost"
              label={t("editorPanels.multiEdit.previewToggle")}
              dirty={!previewEnabled}
              onReset={() => setPreviewEnabled(true)}
            />
          }
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={previewEnabled}
              onChange={(event) => {
                setPreviewEnabled(event.currentTarget.checked);
                onChange(values);
              }}
            />
          )}
        />
      </FieldRows>
      {/* The row mounts only with a message, so no empty hint reserves space. */}
      {resultMessage !== "" && (
        <InlineAlert
          tone={resultError ? "danger" : "success"}
          role="status"
          className="batch-error"
        >
          {resultMessage}
        </InlineAlert>
      )}
      <div className="batch-history" aria-label={t("editorPanels.multiEdit.history")}>
        <IconButton
          icon="chevronLeft"
          size="small"
          className="batch-history-button"
          label={t("editorPanels.multiEdit.historyPrevious")}
          disabled={!canLoadPrevious}
          onClick={() => loadHistory(activeIndex - 1)}
        />
        <span className="batch-history-position" aria-live="polite">
          {`${historyPosition}/${currentIndex + 1}`}
        </span>
        <IconButton
          icon="chevronRight"
          size="small"
          className="batch-history-button"
          label={t("editorPanels.multiEdit.historyNext")}
          disabled={!canLoadNext}
          onClick={() => loadHistory(activeIndex + 1)}
        />
      </div>
      <div className="batch-apply redux-footer-bar">
        <div className="redux-footer-actions">
          <Button type="button" variant="solid" onClick={onApply}>
            {t("editorPanels.multiEdit.apply")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The explicitly typed module shape returned by the lazy form loader. */
export type MultiEditFormModule = {
  MultiEditForm: typeof MultiEditForm;
};
