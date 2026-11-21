/**
 * The event clone form: target sequence, time increment, four channel
 * distributions, keep-source, preview, history, and the commit actions.
 *
 * The panel owns planning and validation; this component owns the draft fields
 * and exposes an imperative handle because the inspector creates it outside the
 * React tree.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import { InlineAlert } from "../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { FieldReset } from "../../../../../design/components/field/FieldReset.tsx";
import { EasingField } from "../../../../../design/components/easing/EasingField.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { t, type MessageKey } from "../../../../../i18n/index.ts";
import {
  cloneChannelsFor,
  defaultCloneParameters,
  type CloneChannelParameters,
  type CloneChannelType,
  type CloneParameters,
} from "../../../../../core/edit/multiEdit/parameters.ts";

/** Localized short name for each channel section. */
const CHANNEL_LABEL_KEYS: Readonly<Record<CloneChannelType, MessageKey>> = {
  moveXEvents: "editorPanels.multiEdit.clone.channel.x",
  moveYEvents: "editorPanels.multiEdit.clone.channel.y",
  rotateEvents: "editorPanels.multiEdit.clone.channel.rotation",
  alphaEvents: "editorPanels.multiEdit.clone.channel.opacity",
  speedEvents: "editorPanels.multiEdit.clone.channel.speed",
  scaleXEvents: "editorPanels.multiEdit.clone.channel.scaleX",
  scaleYEvents: "editorPanels.multiEdit.clone.channel.scaleY",
};

/** The imperative surface the multi-edit panel drives. */
export interface EventCloneFormHandle {
  read(): CloneParameters;
  load(value: Partial<CloneParameters>, options?: { preserveCurrent?: boolean }): void;
  setEventTypes(eventTypes: readonly string[]): void;
  selectHistory(value: string): void;
  setResult(message: string, error: boolean): void;
  setReady(ready: boolean): void;
  setWarning(warning: string): void;
  isPreviewEnabled(): boolean;
}

interface EventCloneFormProps {
  initialValues: CloneParameters;
  defaultTargets: string;
  eventTypes: readonly string[];
  history: CloneParameters[];
  onReady(handle: EventCloneFormHandle): void;
  onChange(value: CloneParameters): void;
  onHistory(index: number): void;
  onApply(): void;
}

/** One labelled clone text field. */
function CloneField({
  title,
  value,
  placeholder,
  textAlign = "right",
  onChange,
}: {
  title: string;
  value: string;
  placeholder?: string;
  textAlign?: "left" | "right";
  onChange(value: string): void;
}) {
  return (
    <FieldRow
      layout="inline"
      density="compact"
      label={title}
      control={(id) => (
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          textAlign={textAlign}
          holdsValue
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    />
  );
}

/** Renders the clone draft and exposes its imperative handle. */
export function EventCloneForm({
  initialValues,
  defaultTargets,
  eventTypes,
  history,
  onReady,
  onChange,
  onHistory,
  onApply,
}: EventCloneFormProps) {
  const [values, setValues] = useState<CloneParameters>(() => structuredClone(initialValues));
  const [selectedTypes, setSelectedTypes] = useState<string[]>(() => [...eventTypes]);
  const [historySelection, setHistorySelection] = useState("");
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const [resultError, setResultError] = useState(false);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState("");
  const currentValues = useRef(values);

  /** Merge one clone draft change, persist it, and clear the history marker. */
  const update = (next: Partial<CloneParameters>) => {
    const value: CloneParameters = {
      ...values,
      ...next,
      mode: "clone",
      channels: { ...values.channels, ...(next.channels ?? {}) },
    };
    setValues(value);
    currentValues.current = value;
    setHistorySelection("");
    onChange(value);
  };

  /** Merge one channel's compact fields without replacing its siblings. */
  const updateChannel = (type: CloneChannelType, next: Partial<CloneChannelParameters>) => {
    update({
      channels: {
        ...values.channels,
        [type]: { ...values.channels[type], ...next },
      },
    });
  };

  const handle = useMemo<EventCloneFormHandle>(
    () => ({
      read: () => values,
      load: (next, options) => {
        const value: CloneParameters = {
          ...values,
          ...next,
          mode: "clone",
          channels: { ...values.channels, ...(next.channels ?? {}) },
        };
        setValues(value);
        if (!options?.preserveCurrent) {
          currentValues.current = value;
        }
      },
      setEventTypes: (types) => setSelectedTypes([...new Set(types)]),
      selectHistory: setHistorySelection,
      setResult: (message, error) => {
        setResultMessage(message);
        setResultError(error);
      },
      setReady: (next) => setReady(next),
      setWarning: (next) => setWarning(next),
      isPreviewEnabled: () => previewEnabled,
    }),
    [values, previewEnabled],
  );
  useLayoutEffect(() => onReady(handle), [handle, onReady]);
  const visibleChannels = cloneChannelsFor(selectedTypes);

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
  /** Reset the draft fields while keeping the remembered keep-source choice. */
  const reset = () => {
    const next = defaultCloneParameters(defaultTargets);
    next.retainSource = values.retainSource;
    update(next);
  };
  const applyDisabled = resultError || !ready;

  return (
    <div className="multi-edit-form batch-clone-form">
      <FieldRows gap="compact">
        <CloneField
          title={t("editorPanels.multiEdit.clone.targets")}
          value={values.targets}
          placeholder={t("editorPanels.multiEdit.clone.targetsPlaceholder")}
          onChange={(targets) => update({ targets })}
        />
        <CloneField
          title={t("editorPanels.multiEdit.clone.increment")}
          value={values.increment}
          placeholder="0"
          textAlign="right"
          onChange={(increment) => update({ increment })}
        />
      </FieldRows>
      {visibleChannels.map((type) => (
        <section className="batch-channel" key={type}>
          <h3 className="line-panel-section-title">{t(CHANNEL_LABEL_KEYS[type])}</h3>
          <FieldRows gap="compact">
            <CloneField
              title={t("editorPanels.multiEdit.distribution.lower")}
              value={values.channels[type].lower}
              placeholder="0"
              onChange={(lower) => updateChannel(type, { lower })}
            />
            <CloneField
              title={t("editorPanels.multiEdit.distribution.upper")}
              value={values.channels[type].upper}
              placeholder="0"
              onChange={(upper) => updateChannel(type, { upper })}
            />
            <EasingField
              label={t("editorPanels.multiEdit.distribution.easingType")}
              value={values.channels[type].easingType}
              onChange={(easingType) => updateChannel(type, { easingType })}
            />
            <CloneField
              title={t("editorPanels.multiEdit.distribution.disturbance")}
              value={values.channels[type].disturbance}
              placeholder="0"
              onChange={(disturbance) => updateChannel(type, { disturbance })}
            />
            <CloneField
              title={t("editorPanels.multiEdit.distribution.cycle")}
              value={values.channels[type].cycle}
              placeholder="1,-1,1"
              onChange={(cycle) => updateChannel(type, { cycle })}
            />
          </FieldRows>
        </section>
      ))}
      <FieldRows gap="compact">
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
                // The panel reads this state through its handle during refresh;
                // commit it first so the same click also repaints the timeline.
                flushSync(() => setPreviewEnabled(checked));
                onChange(values);
              }}
            />
          )}
        />
      </FieldRows>
      <FieldRows gap="compact">
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.multiEdit.clone.retainSource")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={values.retainSource}
              onChange={(event) => update({ retainSource: event.currentTarget.checked })}
            />
          )}
        />
      </FieldRows>
      {warning !== "" && (
        <InlineAlert tone="warning" role="status" className="batch-warning">
          {warning}
        </InlineAlert>
      )}
      {resultMessage !== "" && (
        <InlineAlert tone="danger" role="status" className="batch-error">
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
            <Button type="button" variant="ghost" onClick={reset}>
              {t("editorPanels.multiEdit.clone.reset")}
            </Button>
            <Button type="button" variant="solid" disabled={applyDisabled} onClick={onApply}>
              {t("editorPanels.multiEdit.clone.apply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
