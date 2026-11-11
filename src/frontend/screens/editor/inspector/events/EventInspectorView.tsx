/**
 * The selected-event form: one row per event field, the easing and Bézier
 * editors, the start/end sampling entry, and the cut/stick tools.
 *
 * It reads the live session and tempo grid but delegates every mutation to the
 * event editor commands, so a field never writes a chart on its own.
 */
import { useEffect, useRef, useState } from "react";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { NOISE_ACTIVE_EVENTS } from "../../../../../core/edit/events/eventTracks.ts";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { Popconfirm } from "../../../../../design/components/popconfirm/Popconfirm.tsx";
import { SliderField } from "../../../../../design/components/slider/SliderField.tsx";
import { transformEvents } from "../../../../../core/edit/events/eventEdits.ts";
import { clamp01 } from "../../../../../core/utils/numbers.ts";
import { eventList, eventKey } from "../../../../../core/edit/events/eventTracks.ts";
import type { JudgeLineEvent } from "../../../../../core/global/chart/chart.ts";
import type { Beat } from "../../../../../core/global/chart/timing/beat.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import type { TempoGrid } from "../../../../../core/global/chart/editing/editGrid.ts";
import { canCutEvent } from "../../../../../core/edit/events/eventTools.ts";
import { InspectorEmpty } from "../InspectorEmpty.tsx";
import { runEventTool } from "./eventTools.ts";
import { t } from "../../../../../i18n/index.ts";
import {
  EasingCurveEditor,
  type EasingCurvePatch,
} from "../../../../../design/components/easing/EasingCurveEditor.tsx";
import { displayValue, applyEventTransform, EventField } from "./EventField.tsx";
import type { FieldKey, ValueKind } from "./eventFieldModel.ts";
import { useEditingFeature } from "../../../settings/editingCapabilities.ts";
import { eventHasLinkGroup } from "../../../../../core/global/chart/optionalFeatures.ts";
import { samplingAxisForEventType } from "../../../../../core/edit/sampling/sampling.ts";
import { startSamplingForEvent } from "../../sampling/samplingSession.ts";
import { resolveCurveValues, usableBezierPoints } from "../../sampling/samplingCurveModel.ts";

/** Hold time after which the cut button opens the one-off density prompt. */
const CUT_LONG_PRESS_MS = 500;

export interface InspectorEventEntry {
  type: string;
  index: number;
  event?: JudgeLineEvent;
  lineIndex?: number;
}

export interface EventInspectorViewProps {
  session: EditorSession;
  tempo: TempoGrid;
  entry?: InspectorEventEntry;
  currentBeat: () => number;
  reportError: (error: unknown) => void;
  notify: (message: string, kind?: string) => void;
  refresh: () => void;
  onCurvePreview: (patch: EasingCurvePatch | null) => void;
  setLiveEventEdit: (active: boolean) => void;
  setEventSelection: (selection: Set<string>) => void;
  onNudge: (value: Beat, direction: number) => Beat | null;
}

/** Chooses the control kind for an event's start or end value. */
function eventValueKind(type: string, value: unknown): ValueKind {
  if (type === "colorEvents" && Array.isArray(value)) {
    return "array";
  }
  if (type === "textEvents" && typeof value === "string") {
    return "text";
  }
  return Array.isArray(value) ? "array" : "number";
}

/**
 * One easing edge as a 0-1 slider. The rate is a proportion, so it uses the
 * level bar with an exact numeric readout and writes through the same event
 * transform as every other field.
 */
function EasingRangeField({
  session,
  event,
  field,
  title,
  reportError,
  refresh,
  setLiveEventEdit,
}: {
  session: EditorSession;
  event: JudgeLineEvent;
  field: "easingLeft" | "easingRight";
  title: string;
  reportError: (error: unknown) => void;
  refresh: () => void;
  setLiveEventEdit: (active: boolean) => void;
}) {
  const fallback = field === "easingRight" ? 1 : 0;
  const value = clamp01(Number(event[field] ?? fallback));
  const commit = (next: number) => {
    try {
      applyEventTransform(
        session,
        t("editorPanels.inspector.event.modify", { field: title }),
        (current) => ({ ...current, [field]: clamp01(next) }),
      );
    } catch (error) {
      reportError(error);
    }
  };
  const id = `event-field-${field}`;
  return (
    <FieldRow
      layout="inline"
      density="compact"
      htmlFor={id}
      label={title}
      control={
        <SliderField
          id={id}
          min={0}
          max={1}
          step={0.01}
          value={value}
          data-inspector-field={field}
          aria-label={title}
          onChange={(input) => commit(Number(input.currentTarget.value))}
          onFocus={() => setLiveEventEdit(true)}
          onBlur={() => {
            setLiveEventEdit(false);
            queueMicrotask(() => {
              if (!session.liveEventEdit) {
                refresh();
              }
            });
          }}
        />
      }
    />
  );
}

/** Renders the selected event's fields, curve controls, and tools. */
export function EventInspectorView({
  session,
  tempo,
  entry,
  currentBeat,
  reportError,
  notify,
  refresh,
  onCurvePreview,
  setLiveEventEdit,
  setEventSelection,
  onNudge,
}: EventInspectorViewProps) {
  useEffect(() => () => onCurvePreview(null), [onCurvePreview]);
  const bezierEnabled = useEditingFeature("bezier");
  const linkgroupEnabled = useEditingFeature("linkgroup");
  const easingRangeEnabled = useEditingFeature("easingRange");
  const [cutAnchorElement, setCutAnchorElement] = useState<HTMLButtonElement | null>(null);
  const [cutOpen, setCutOpen] = useState(false);
  const [cutDensity, setCutDensity] = useState("");
  const cutPressAt = useRef<number | null>(null);
  const cutLongPressed = useRef(false);
  const event = entry?.event;
  if (!event || !entry) {
    return <InspectorEmpty>{t("editorPanels.inspector.event.emptyHint")}</InspectorEmpty>;
  }
  const eventType = entry.type;
  /** Runs an edit action and reports its failure without unwinding the form. */
  const safely = (action: () => void) => {
    try {
      action();
    } catch (error) {
      reportError(error);
    }
  };
  /** Records when the cut button was pressed so a hold can be measured. */
  const beginCutPress = () => {
    cutPressAt.current = performance.now();
  };

  /** Opens the density prompt after a hold; a short press is left to click. */
  const releaseCutPress = () => {
    const started = cutPressAt.current;
    cutPressAt.current = null;
    if (started === null || performance.now() - started < CUT_LONG_PRESS_MS) {
      return;
    }
    cutLongPressed.current = true;
    setCutDensity(String(session.cutDensity));
    setCutOpen(true);
    // The click that follows this release belongs to the press, not to a new
    // command. Reset after the click phase so a later click runs normally.
    window.setTimeout(() => {
      cutLongPressed.current = false;
    }, 0);
  };
  /** Drops a press that ended outside the button. */
  const cancelCutPress = () => {
    cutPressAt.current = null;
  };

  /** Runs the cut with the density typed into the prompt. */
  const confirmCut = () => {
    const density = Number(cutDensity);
    if (!Number.isInteger(density) || density < 1 || density > 16) {
      notify(t("editorPanels.inspector.event.cutDensityInvalid"), "error");
      return;
    }
    setCutOpen(false);
    runEventTool(session, tempo, "cut", notify, currentBeat(), { density });
  };
  /** Runs the cut with the session's stored density. */
  const cutWithSessionDensity = () => runEventTool(session, tempo, "cut", notify, currentBeat());
  if (eventType === NOISE_ACTIVE_EVENTS) {
    return (
      <>
        <FieldRows>
          {(["startTime", "endTime"] as const).map((field) => (
            <EventField
              key={`${entry.index}:${field}:${displayValue(event, field)}`}
              session={session}
              eventType={eventType}
              event={event}
              field={field}
              title={t(
                field === "startTime"
                  ? "editorPanels.inspector.field.startTime"
                  : "editorPanels.inspector.field.endTime",
              )}
              kind="beat"
              reportError={reportError}
              refresh={refresh}
              setLiveEventEdit={setLiveEventEdit}
              onNudge={onNudge}
            />
          ))}
        </FieldRows>
        <p className="hint">{t("editorPanels.linePanel.noiseActiveHint")}</p>
      </>
    );
  }
  const valueTitles: [string, string] =
    eventType === "alphaEvents"
      ? [t("editorPanels.inspector.event.startAlpha"), t("editorPanels.inspector.event.endAlpha")]
      : eventType === "speedEvents"
        ? [t("editorPanels.inspector.event.startSpeed"), t("editorPanels.inspector.event.endSpeed")]
        : eventType === "colorEvents"
          ? [
              t("editorPanels.inspector.event.startColor"),
              t("editorPanels.inspector.event.endColor"),
            ]
          : eventType === "textEvents"
            ? [
                t("editorPanels.inspector.event.startText"),
                t("editorPanels.inspector.event.endText"),
              ]
            : [
                t("editorPanels.inspector.event.startValue"),
                t("editorPanels.inspector.event.endValue"),
              ];
  const fields: [FieldKey, string, ValueKind][] = [
    ["startTime", t("editorPanels.inspector.field.startTime"), "beat"],
    ["endTime", t("editorPanels.inspector.field.endTime"), "beat"],
    ["start", valueTitles[0], eventValueKind(eventType, event.start)],
    ["end", valueTitles[1], eventValueKind(eventType, event.end)],
    // A link group is an optional event relationship. Keep the field when the
    // selected event already belongs to one, so it can still be inspected or
    // cleared after the capability switch is turned off.
    ...(linkgroupEnabled || eventHasLinkGroup(event)
      ? [
          ["linkgroup", t("editorPanels.inspector.event.linkgroup"), "number"] as [
            FieldKey,
            string,
            ValueKind,
          ],
        ]
      : []),
  ];
  /** Selects every event that shares the current link group. */
  const selectLinkGroup = () => {
    const link = Number(event.linkgroup ?? 0);
    if (link <= 0) {
      return;
    }
    const selection = new Set<string>();
    const layers = session.line?.eventLayers?.[session.eventLayer] ?? null;
    for (const type of layers ? Object.keys(layers) : []) {
      for (const [index, candidate] of (eventList(session, type) ?? []).entries()) {
        if (Number(candidate.linkgroup) === link) {
          selection.add(eventKey(type, index));
        }
      }
    }
    if (session.line?.extended) {
      for (const type of Object.keys(session.line.extended)) {
        for (const [index, candidate] of (eventList(session, type) ?? []).entries()) {
          if (Number(candidate.linkgroup) === link) {
            selection.add(eventKey(type, index));
          }
        }
      }
    }
    setEventSelection(selection);
    session.notify();
  };
  /** Applies one curve-editor patch as a single event edit. */
  const changeCurve = (patch: EasingCurvePatch) => {
    safely(() => {
      if (patch.bezier !== undefined) {
        const nextBezier = patch.bezier;
        applyEventTransform(session, t("editorPanels.inspector.event.toggleBezier"), (current) => ({
          ...current,
          bezier: nextBezier ? 1 : 0,
          ...(nextBezier
            ? { bezierPoints: patch.bezierPoints ?? usableBezierPoints(current.bezierPoints) }
            : {}),
        }));
        return;
      }
      if (patch.bezierPoints !== undefined) {
        const points = patch.bezierPoints;
        applyEventTransform(session, t("editorPanels.inspector.event.modifyBezier"), (current) => ({
          ...current,
          bezierPoints: points,
        }));
        return;
      }
      if (patch.easingType !== undefined) {
        const easingType = patch.easingType;
        applyEventTransform(session, t("editorPanels.inspector.event.modifyEasing"), (current) => ({
          ...current,
          easingType,
        }));
        return;
      }
      const field = patch.easingLeft !== undefined ? "easingLeft" : "easingRight";
      const title = t(
        field === "easingLeft"
          ? "editorPanels.inspector.event.easingLeft"
          : "editorPanels.inspector.event.easingRight",
      );
      applyEventTransform(
        session,
        t("editorPanels.inspector.event.modify", { field: title }),
        (current) => ({
          ...current,
          ...(patch.easingLeft !== undefined ? { easingLeft: clamp01(patch.easingLeft) } : {}),
          ...(patch.easingRight !== undefined ? { easingRight: clamp01(patch.easingRight) } : {}),
        }),
      );
    });
  };
  const curveValues = resolveCurveValues({
    bezier: event.bezier,
    bezierPoints: event.bezierPoints,
    easingLeft: event.easingLeft,
    easingRight: event.easingRight,
  });
  const curveMode = bezierEnabled && curveValues.bezier ? "bezier" : "easing";
  const rangeVisible =
    easingRangeEnabled ||
    Number(event.easingLeft ?? 0) !== 0 ||
    Number(event.easingRight ?? 1) !== 1;
  const link = Number(event.linkgroup ?? 0);
  const samplingSupported = samplingAxisForEventType(eventType) !== null;

  return (
    <>
      <FieldRows>
        {fields.map(([field, title, kind]) => (
          <EventField
            key={`${entry.lineIndex ?? ""}:${entry.type}:${entry.index}:${field}:${displayValue(event, field)}`}
            session={session}
            eventType={eventType}
            event={event}
            field={field}
            title={title}
            kind={kind}
            reportError={reportError}
            refresh={refresh}
            setLiveEventEdit={setLiveEventEdit}
            onNudge={onNudge}
            disabled={Boolean(event.inst) && field === "end"}
          />
        ))}
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="event-field-inst"
          label={t("editorPanels.inspector.event.hook")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={Boolean(event.inst)}
              onChange={(input) => {
                const checked = input.currentTarget.checked;
                safely(() =>
                  applyEventTransform(
                    session,
                    t("editorPanels.inspector.event.modifyHook"),
                    (current) => ({
                      ...current,
                      inst: checked ? 1 : 0,
                      ...(checked ? { end: structuredClone(current.start) } : {}),
                    }),
                  ),
                );
              }}
            />
          )}
        />
      </FieldRows>
      {link > 0 && (
        <Button
          type="button"
          variant="outlined"
          className="wide-button"
          onClick={() => safely(selectLinkGroup)}
        >
          {t("editorPanels.inspector.event.selectLinkGroup", { group: link })}
        </Button>
      )}
      {/* Bézier editing is optional. With it off, ordinary events use the
          easing group only; an event that already carries a Bézier keeps its
          curve but reports that the editor is disabled rather than presenting
          easing controls that would not affect the rendered curve. */}
      <EasingCurveEditor
        mode={curveMode}
        easingType={Number(event.easingType ?? 1)}
        bezier={curveValues.bezier}
        bezierPoints={curveValues.bezierPoints}
        easingLeft={curveValues.easingLeft}
        easingRight={curveValues.easingRight}
        onChange={changeCurve}
        onPreview={onCurvePreview}
        easingLabel={t("editorPanels.inspector.event.easing")}
        rangeIds={{ left: "event-field-easingLeft", right: "event-field-easingRight" }}
        modeClassName="is-block"
        bezierKey={`${entry.lineIndex ?? ""}:${entry.type}:${entry.index}:bezier:${curveValues.bezierPoints.join(",")}`}
        showRange={rangeVisible}
        bezierEnabled={() => bezierEnabled}
        easingRangeEnabled={() => easingRangeEnabled}
        renderRangeField={(field, row) => (
          <EasingRangeField
            session={session}
            event={event}
            field={field}
            title={row.label}
            reportError={reportError}
            refresh={refresh}
            setLiveEventEdit={setLiveEventEdit}
          />
        )}
      />
      <div className="action-grid event-tool-actions">
        {samplingSupported && (
          <Button
            type="button"
            variant="solid"
            className="event-sample-entry"
            data-tip-desc={t("editorPanels.sampling.entryHint")}
            onClick={() =>
              startSamplingForEvent(session, {
                lineIndex: entry.lineIndex ?? session.lineIndex,
                eventType,
                eventIndex: entry.index,
                eventId: event.id,
                eventLayer: session.eventLayer,
              })
            }
          >
            {t("editorPanels.sampling.entry")}
          </Button>
        )}
        <Button
          type="button"
          variant="outlined"
          onClick={() => runEventTool(session, tempo, "stick", notify, currentBeat())}
        >
          {t("editorPanels.inspector.event.stickPrevious")}
        </Button>
        <Button
          ref={setCutAnchorElement}
          type="button"
          variant="outlined"
          disabled={!canCutEvent(eventType, event)}
          data-tip-desc={t("editorPanels.inspector.event.cutHint")}
          onPointerDown={beginCutPress}
          onPointerUp={releaseCutPress}
          onPointerLeave={cancelCutPress}
          onPointerCancel={cancelCutPress}
          onClick={() => {
            if (cutLongPressed.current) {
              cutLongPressed.current = false;
              return;
            }
            cutWithSessionDensity();
          }}
        >
          {t("editorPanels.inspector.event.cutEvent")}
        </Button>
        <Button
          type="button"
          variant="outlined"
          onClick={() =>
            safely(() =>
              transformEvents(session, t("editorPanels.inspector.event.swapLabel"), (current) => ({
                ...current,
                start: current.end,
                end: current.start,
              })),
            )
          }
        >
          {t("editorPanels.inspector.event.swap")}
        </Button>
      </div>
      <Popconfirm
        open={cutOpen}
        anchor={cutAnchorElement}
        title={t("editorPanels.inspector.event.cutDensityTitle")}
        description={t("editorPanels.inspector.event.cutDensityDescription")}
        confirmLabel={t("editorPanels.inspector.event.cutEvent")}
        destructive
        onCancel={() => setCutOpen(false)}
        onConfirm={confirmCut}
      >
        <FieldRow
          layout="inline"
          density="compact"
          htmlFor="event-cut-density"
          label={t("editorPanels.inspector.event.cutDensityLabel")}
          control={
            <Input
              id="event-cut-density"
              type="number"
              min={1}
              max={16}
              step={1}
              value={cutDensity}
              data-autofocus
              onChange={(input) => setCutDensity(input.currentTarget.value)}
              onFocus={(input) => input.currentTarget.select()}
            />
          }
        />
      </Popconfirm>
    </>
  );
}
