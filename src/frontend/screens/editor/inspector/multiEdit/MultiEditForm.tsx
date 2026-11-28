/**
 * The batch-edit form: operation, target fields, and their parameters.
 *
 * It exposes an imperative handle that the panel model drives, because the same
 * element is created outside this component's tree. Field state and validation
 * messages stay local to the form.
 */
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { MultiSelect } from "../../../../../design/components/select/MultiSelect.tsx";
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
import {
  BATCH_OPERATIONS,
  noteBatchFields,
  EVENT_BATCH_FIELDS,
} from "../../../../../core/edit/multiEdit/planVocabulary.ts";
import { noteFields } from "../../../../../core/global/chart/noteFields.ts";
import { NOISE_ACTIVE_EVENTS } from "../../../../../core/edit/events/eventTracks.ts";
import {
  defaultBatchParameters,
  type BatchParameters,
  type MultiEditKind,
} from "../../../../../core/edit/multiEdit/parameters.ts";
import {
  canSelectEventType,
  defaultEventFieldForFamily,
  eventFamilyForTypes,
  eventTypesForSelection,
  isEventFieldAllowed,
} from "../../../../../core/edit/multiEdit/eventTargets.ts";
import { useEditingFeature } from "../../../settings/editingCapabilities.ts";
import { BeatField } from "../beat/BeatField.tsx";

type Option = readonly [string | number, string];

export type MultiEditFormValues = BatchParameters & {
  /** Discriminates the original form batch from the event clone draft. */
  mode: "edit";
  eventApplicationMode: string;
  /** Event tracks selected by the current chart selection; not a persisted draft field. */
  eventTypes: string[];
};

export interface MultiEditFormHandle {
  read(): MultiEditFormValues;
  load(value: Partial<MultiEditFormValues>, options?: { preserveCurrent?: boolean }): void;
  setAvailableEventTypes(eventTypes: readonly string[]): void;
  selectHistory(value: string): void;
  setResult(message: string, error: boolean): void;
  isPreviewEnabled(): boolean;
}

interface MultiEditFormProps {
  kind: MultiEditKind;
  multiEventEdit: boolean;
  noiseActivation: boolean;
  availableEventTypes: readonly string[];
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
            preservePartsOnBlur
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
  availableEventTypes,
  history,
  onReady,
  onChange,
  onHistory,
  onApply,
}: MultiEditFormProps) {
  const noteFieldRevision = useSyncExternalStore(
    noteFields.subscribe.bind(noteFields),
    noteFields.getRevision.bind(noteFields),
    noteFields.getRevision.bind(noteFields),
  );
  const linkgroupEnabled = useEditingFeature("linkgroup");
  const noteSpeedEnabled = useEditingFeature("noteSpeed");
  const noteSizeEnabled = useEditingFeature("noteSize");
  const noteAlphaEnabled = useEditingFeature("noteAlpha");
  const noteYOffsetEnabled = useEditingFeature("noteYOffset");
  const noteVisibleTimeEnabled = useEditingFeature("noteVisibleTime");
  const noteColorEnabled = useEditingFeature("noteColor");
  const noteHitSoundEnabled = useEditingFeature("noteHitSound");
  const [values, setValues] = useState<MultiEditFormValues>(() => ({
    mode: "edit",
    ...defaultBatchParameters(kind),
    ...(noiseActivation ? { field: "t1" } : {}),
    eventApplicationMode: "per-line",
    eventTypes: eventTypesForSelection(availableEventTypes).slice(0, 1),
  }));
  const [historySelection, setHistorySelection] = useState("");
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [resultError, setResultError] = useState(false);
  const currentValues = useRef(values);
  const update = (next: Partial<MultiEditFormValues>) => {
    const value = { ...values, ...next } as MultiEditFormValues;
    if (kind === "events" && value.eventTypes.length > 0) {
      const family = eventFamilyForTypes(value.eventTypes);
      if (!isEventFieldAllowed(value.field, family)) {
        value.field = defaultEventFieldForFamily(family) ?? "t1";
      }
    }
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
          mode: "edit" as const,
          ...defaultBatchParameters(kind),
          eventApplicationMode: "per-line",
          ...next,
          eventTypes: Array.isArray((next as Partial<MultiEditFormValues>).eventTypes)
            ? eventTypesForSelection((next as Partial<MultiEditFormValues>).eventTypes ?? [])
            : eventTypesForSelection(availableEventTypes).slice(0, 1),
        } as MultiEditFormValues;
        if (kind === "events" && !EVENT_BATCH_FIELDS.some(([key]) => key === value.field)) {
          value.field = "both";
        }
        if (kind === "events" && value.eventTypes.length > 0) {
          const loadedFamily = eventFamilyForTypes(value.eventTypes);
          if (!isEventFieldAllowed(value.field, loadedFamily)) {
            value.field = defaultEventFieldForFamily(loadedFamily) ?? "t1";
          }
        }
        const loadedNoteField = kind === "notes" ? noteFields.findByField(value.field) : null;
        if (loadedNoteField) {
          value.operation = "To";
          if (
            loadedNoteField.kind === "select" &&
            !loadedNoteField.options?.some(([option]) => option === value.lower)
          ) {
            value.lower = "";
          }
        }
        if (noiseActivation && !["t1", "t2"].includes(value.field)) {
          value.field = "t1";
        }
        setValues(value);
        if (!options?.preserveCurrent) {
          currentValues.current = value;
        }
      },
      setAvailableEventTypes: (nextTypes) => {
        const available = eventTypesForSelection(nextTypes);
        const availableSet = new Set(available);
        const retained = values.eventTypes.filter((type) => availableSet.has(type));
        const nextEventTypes = retained.length ? retained : available.slice(0, 1);
        const value = { ...values, eventTypes: nextEventTypes } as MultiEditFormValues;
        if (kind === "events" && nextEventTypes.length > 0) {
          const family = eventFamilyForTypes(nextEventTypes);
          if (!isEventFieldAllowed(value.field, family)) {
            value.field = defaultEventFieldForFamily(family) ?? "t1";
          }
        }
        if (
          nextEventTypes.length === values.eventTypes.length &&
          nextEventTypes.every((type, index) => type === values.eventTypes[index]) &&
          value.field === values.field
        ) {
          return;
        }
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
    [values, previewEnabled, kind, noiseActivation, availableEventTypes, onChange],
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
  const contributedFields = useMemo(
    () =>
      noteFieldRevision >= 0
        ? new Set(noteFields.list().map((field) => field.field))
        : new Set<string>(),
    [noteFieldRevision],
  );
  const selectedEventFamily = kind === "events" ? eventFamilyForTypes(values.eventTypes) : null;
  const fields: readonly Option[] = (
    kind === "notes"
      ? noteBatchFields().filter(([key]) => noteFieldsEnabled[key] ?? contributedFields.has(key))
      : EVENT_BATCH_FIELDS.filter(([key]) => {
          const familyAllowsField =
            values.eventTypes.length === 0 || isEventFieldAllowed(key, selectedEventFamily);
          const noiseAllowsField = noiseActivation ? ["t1", "t2"].includes(key) : true;
          return familyAllowsField && noiseAllowsField && (key !== "linkgroup" || linkgroupEnabled);
        })
  ).map(
    ([key, label]) =>
      [key, shortLabel(contributedFields.has(key) ? label : t(label as MessageKey))] as const,
  );
  const eventFieldInvalid =
    kind === "events" &&
    !noiseActivation &&
    (values.eventTypes.length === 0 || !isEventFieldAllowed(values.field, selectedEventFamily));
  const selectedNoteField = kind === "notes" ? noteFields.findByField(values.field) : null;
  const operations = (
    selectedNoteField?.kind === "select"
      ? BATCH_OPERATIONS.filter(([key]) => key === "To")
      : BATCH_OPERATIONS
  ).map(([key, label]) => [key, shortLabel(t(label))] as const);
  const contributedField = selectedNoteField !== null;
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
        {kind === "events" && !noiseActivation && (
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.multiEdit.eventType")}
            control={(id) => (
              <MultiSelect
                id={id}
                value={values.eventTypes}
                options={availableEventTypes.map((type) => {
                  const checked = values.eventTypes.includes(type);
                  return {
                    value: type,
                    label: eventTypeLabel(type),
                    disabled: !checked && !canSelectEventType(values.eventTypes, type),
                  };
                })}
                placeholder={`(${t("editorPanels.multiEdit.eventType.none")})`}
                onChange={(eventTypes) => update({ eventTypes })}
              />
            )}
          />
        )}
        <Field
          title={t("editorPanels.multiEdit.field")}
          value={values.field}
          options={fields}
          onChange={(field) => {
            const noteField = kind === "notes" ? noteFields.findByField(field) : null;
            update({ field, ...(noteField?.kind === "select" ? { operation: "To" } : {}) });
          }}
        />
        <Field
          title={t("editorPanels.multiEdit.operation")}
          value={values.operation}
          options={operations}
          onChange={(operation) => update({ operation })}
        />
        <Field
          title={
            contributedField
              ? (selectedNoteField?.label ?? t("editorPanels.multiEdit.distribution.lower"))
              : t("editorPanels.multiEdit.distribution.lower")
          }
          value={values.lower}
          options={selectedNoteField?.kind === "select" ? selectedNoteField.options : undefined}
          beat={beatBounds ? batchBeat(values.lower) : undefined}
          onChange={(lower) => update({ lower })}
        />
        {!contributedField && (
          <>
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
          </>
        )}
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
              onReset={() => {
                flushSync(() => setPreviewEnabled(true));
                onChange(values);
              }}
            />
          }
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={previewEnabled}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                // Commit the toggle before the panel reads the imperative handle;
                // the same event must repaint the timeline's hidden sources.
                flushSync(() => setPreviewEnabled(checked));
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
      <div className="batch-dock">
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
            <Button type="button" variant="solid" disabled={eventFieldInvalid} onClick={onApply}>
              {t("editorPanels.multiEdit.apply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The explicitly typed module shape returned by the lazy form loader. */
export type MultiEditFormModule = {
  MultiEditForm: typeof MultiEditForm;
};
