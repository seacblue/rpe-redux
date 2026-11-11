/**
 * Judge-line note control curves.
 *
 * The five RPE control tracks are sampled by note floor distance, not chart
 * time. This editor shows one track at a time as a draggable graph, keeps a
 * point list for precise values, and commits once per gesture so undo history
 * records one edit rather than one entry per pointer frame.
 */
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Select } from "../../../../../design/components/select/Select.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import type { MessageKey } from "../../../../../i18n/index.ts";
import type { Chart, ControlPoint, JudgeLine } from "../../../../../core/global/chart/chart.ts";
import type {
  ControlTrackField,
  ControlTrackProperty,
} from "../../../../../core/global/chart/chartTracks.ts";
import {
  controlTrackDomain,
  controlTrackValue,
} from "../../../../../core/global/chart/editing/controlTracks.ts";

/** One editable line-control track, in the order the panel shows it. */
interface CurveTrack {
  field: ControlTrackField;
  property: ControlTrackProperty;
  neutral: number;
  label: MessageKey;
  step: string;
}

const TRACKS: readonly CurveTrack[] = [
  {
    field: "posControl",
    property: "pos",
    neutral: 1,
    label: "editorPanels.linePanel.controlX",
    step: "0.01",
  },
  {
    field: "yControl",
    property: "y",
    neutral: 1,
    label: "editorPanels.linePanel.controlY",
    step: "0.01",
  },
  {
    field: "skewControl",
    property: "skew",
    neutral: 0,
    label: "editorPanels.linePanel.controlSkew",
    step: "1",
  },
  {
    field: "sizeControl",
    property: "size",
    neutral: 1,
    label: "editorPanels.linePanel.controlSize",
    step: "0.01",
  },
  {
    field: "alphaControl",
    property: "alpha",
    neutral: 1,
    label: "editorPanels.linePanel.controlAlpha",
    step: "0.01",
  },
];

/** Native RPE's sentinel endpoint; it is not a useful graph handle. */
const GRAPH_WIDTH = 320;
const GRAPH_HEIGHT = 170;

/** One point field draft, kept separate from the chart until blur. */
interface PointDraft {
  x: string;
  value: string;
}

interface LineControlCurvesProps {
  chart: Chart;
  line: JudgeLine;
  lineIndex: number;
  onCommit(label: string, chart: Chart, index?: number): void;
  notify(message: string, kind?: string): void;
}

/** A four-decimal formatter that does not leave trailing zeroes on the graph. */
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toFixed(4).replace(/\.?0+$/u, "");
}

/** Reads a track as editable points, or the neutral two-point preview. */
function readPoints(
  line: JudgeLine,
  track: CurveTrack,
): { points: ControlPoint[]; owned: boolean } {
  const stored = line[track.field];
  if (Array.isArray(stored) && stored.length) {
    return { points: stored.map((point) => ({ ...point })), owned: true };
  }
  return {
    points: [
      { x: 0, [track.property]: track.neutral, easing: 1 },
      { x: 1000, [track.property]: track.neutral, easing: 1 },
    ],
    owned: false,
  };
}

/** Renders one selected line's control-curve editor. */
export function LineControlCurves({
  chart,
  line,
  lineIndex,
  onCommit,
  notify,
}: LineControlCurvesProps) {
  const { t } = useTranslation();
  const controlId = useId();
  const trackId = `${controlId}-track`;
  const xId = `${controlId}-x`;
  const valueId = `${controlId}-value`;
  const [trackIndex, setTrackIndex] = useState(0);
  const track = TRACKS[trackIndex] ?? TRACKS[0];
  const sourceKey = `${line.id ?? lineIndex}:${track.field}:${
    Array.isArray(line[track.field]) ? JSON.stringify(line[track.field]) : "none"
  }`;
  const initial = readPoints(line, track);
  const [draft, setDraft] = useState<ControlPoint[]>(initial.points);
  const [owned, setOwned] = useState(initial.owned);
  const [source, setSource] = useState(sourceKey);
  const [selected, setSelected] = useState(0);
  const draftRef = useRef(draft);
  const dragCleanup = useRef<(() => void) | null>(null);

  if (source !== sourceKey) {
    const next = readPoints(line, track);
    setSource(sourceKey);
    setDraft(next.points);
    setOwned(next.owned);
    setSelected(0);
  }

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(
    () => () => {
      dragCleanup.current?.();
    },
    [],
  );

  /** Replaces the draft and its drag-time mirror. */
  const updateDraft = (points: ControlPoint[]): void => {
    draftRef.current = points;
    setDraft(points);
  };

  /** Writes one track into the chart, or removes it when empty. */
  const commitPoints = (
    points: ControlPoint[],
    label = t("editorPanels.linePanel.controlCommit"),
  ): void => {
    const nextLine = { ...line };
    if (points.length) {
      nextLine[track.field] = points.map((point) => ({ ...point }));
    } else {
      delete nextLine[track.field];
    }
    const lines = [...(chart.judgeLineList ?? [])];
    lines[lineIndex] = nextLine;
    try {
      onCommit(label, { ...chart, judgeLineList: lines }, lineIndex);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const domain = controlTrackDomain(draft, track.property, track.neutral);
  const sorted = [...draft].sort((left, right) => (left.x ?? 0) - (right.x ?? 0));
  const sampleCount = 96;
  const path = Array.from({ length: sampleCount + 1 }, (unused, index) => {
    const x = domain.minX + ((domain.maxX - domain.minX) * index) / sampleCount;
    const y = controlTrackValue(sorted, track.property, track.neutral, x);
    const px = ((x - domain.minX) / (domain.maxX - domain.minX)) * GRAPH_WIDTH;
    const py =
      GRAPH_HEIGHT -
      ((y - domain.minY) / Math.max(0.0001, domain.maxY - domain.minY)) * GRAPH_HEIGHT;
    return `${index === 0 ? "M" : "L"}${px.toFixed(2)} ${py.toFixed(2)}`;
  }).join(" ");
  const neutralY =
    GRAPH_HEIGHT -
    ((track.neutral - domain.minY) / Math.max(0.0001, domain.maxY - domain.minY)) * GRAPH_HEIGHT;
  const selectedPoint = draft[Math.min(selected, Math.max(0, draft.length - 1))];
  const selectedX = selectedPoint ? Number(selectedPoint.x ?? 0) : 0;
  const selectedValue = selectedPoint ? Number(selectedPoint[track.property] ?? track.neutral) : 0;
  const selectedDraft: PointDraft = {
    x: formatNumber(selectedX),
    value: formatNumber(selectedValue),
  };

  /** Maps one pointer position to the graph's distance and value. */
  const pointerValue = (clientX: number, clientY: number, rect: DOMRect) => {
    const ratioX = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    const ratioY = Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height)));
    return {
      x: domain.minX + ratioX * (domain.maxX - domain.minX),
      value: domain.minY + (1 - ratioY) * (domain.maxY - domain.minY),
    };
  };

  /** Updates one point in the local draft and optionally commits it. */
  const setPoint = (index: number, patch: Partial<ControlPoint>, commit: boolean): void => {
    const next = draftRef.current.map((point, current) =>
      current === index ? { ...point, ...patch } : point,
    );
    updateDraft(next);
    if (commit) {
      commitPoints(next);
    }
  };

  /** Adds a point at the clicked distance using the current curve value. */
  const addPoint = (clientX: number, clientY: number, rect: DOMRect): void => {
    const { x, value } = pointerValue(clientX, clientY, rect);
    const next = [
      ...draftRef.current,
      { x: Number(x.toFixed(3)), [track.property]: Number(value.toFixed(4)), easing: 1 },
    ];
    updateDraft(next);
    setSelected(next.length - 1);
    commitPoints(next);
  };

  /** Starts one drag gesture; the chart commits only when the pointer lifts. */
  const startDrag = (index: number, event: ReactPointerEvent<SVGCircleElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setSelected(index);
    dragCleanup.current?.();
    const svg = event.currentTarget.ownerSVGElement;
    const move = (moveEvent: PointerEvent) => {
      if (!svg) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      const { x, value } = pointerValue(moveEvent.clientX, moveEvent.clientY, rect);
      setPoint(
        index,
        { x: Number(x.toFixed(3)), [track.property]: Number(value.toFixed(4)) },
        false,
      );
    };
    const end = () => {
      dragCleanup.current?.();
      dragCleanup.current = null;
      commitPoints(draftRef.current);
    };
    const cancel = () => {
      dragCleanup.current?.();
      dragCleanup.current = null;
      updateDraft(readPoints(line, track).points);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    dragCleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
  };

  /** Deletes the selected point, or resets the track when it is the last one. */
  const deletePoint = (): void => {
    const next = draftRef.current.filter((unused, index) => index !== selected);
    setSelected(Math.max(0, Math.min(selected, next.length - 1)));
    updateDraft(next);
    commitPoints(next, t("editorPanels.linePanel.controlDeletePoint"));
  };

  /** Removes the authored track and returns to the neutral default. */
  const resetTrack = (): void => {
    updateDraft(readPoints({ ...line, [track.field]: undefined }, track).points);
    commitPoints([], t("editorPanels.linePanel.controlReset"));
  };

  /** Applies one numeric point field after the author leaves it. */
  const applyPointField = (field: "x" | "value", raw: string): void => {
    const value = Number(raw);
    if (!Number.isFinite(value) || !selectedPoint) {
      return;
    }
    setPoint(selected, field === "x" ? { x: value } : { [track.property]: value }, true);
  };

  return (
    <section
      className="line-controls"
      aria-label={t("editorPanels.linePanel.controlCurves")}
      data-track={track.field}
    >
      <div className="line-controls-head">
        <h3 className="line-panel-section-title">
          {t("editorPanels.linePanel.controlCurves")}
          <small>{t("editorPanels.linePanel.controlPoints", { count: draft.length })}</small>
        </h3>
        <Button
          type="button"
          variant="outlined"
          density="compact"
          disabled={!owned}
          onClick={resetTrack}
        >
          {t("editorPanels.linePanel.controlReset")}
        </Button>
      </div>
      <p className="line-controls-hint">{t("editorPanels.linePanel.controlHint")}</p>
      <FieldRow
        layout="inline"
        density="compact"
        htmlFor={trackId}
        label={t("editorPanels.linePanel.controlTrack")}
        control={
          <Select
            id={trackId}
            value={track.field}
            onChange={(event) =>
              setTrackIndex(
                Math.max(
                  0,
                  TRACKS.findIndex((entry) => entry.field === event.currentTarget.value),
                ),
              )
            }
          >
            {TRACKS.map((entry) => (
              <option value={entry.field} key={entry.field}>
                {t(entry.label)}
              </option>
            ))}
          </Select>
        }
      />
      <div className="line-control-graph-wrap">
        <svg
          className="line-control-graph"
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={t("editorPanels.linePanel.controlGraph", {
            track: t(track.label),
          })}
        >
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={`v${ratio}`}
              className="line-control-grid"
              x1={GRAPH_WIDTH * ratio}
              y1={0}
              x2={GRAPH_WIDTH * ratio}
              y2={GRAPH_HEIGHT}
            />
          ))}
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={`h${ratio}`}
              className="line-control-grid"
              x1={0}
              y1={GRAPH_HEIGHT * ratio}
              x2={GRAPH_WIDTH}
              y2={GRAPH_HEIGHT * ratio}
            />
          ))}
          <line
            className="line-control-neutral"
            x1={0}
            y1={neutralY}
            x2={GRAPH_WIDTH}
            y2={neutralY}
          />
          <path className="line-control-curve" d={path} />
          <rect
            className="line-control-hit"
            x={0}
            y={0}
            width={GRAPH_WIDTH}
            height={GRAPH_HEIGHT}
            onClick={(event) => {
              const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
              if (rect) {
                addPoint(event.clientX, event.clientY, rect);
              }
            }}
          />
          {sorted.map((point, index) => {
            const x = Number(point.x ?? 0);
            if (x < domain.minX || x > domain.maxX) {
              return null;
            }
            const y = Number(point[track.property] ?? track.neutral);
            const px = ((x - domain.minX) / (domain.maxX - domain.minX)) * GRAPH_WIDTH;
            const py =
              GRAPH_HEIGHT -
              ((y - domain.minY) / Math.max(0.0001, domain.maxY - domain.minY)) * GRAPH_HEIGHT;
            const pointIndex = draft.indexOf(point);
            return (
              <circle
                key={`${pointIndex}:${x}:${y}`}
                className={`line-control-handle${pointIndex === selected ? " is-selected" : ""}`}
                cx={px}
                cy={py}
                r={pointIndex === selected ? 7 : 5}
                tabIndex={0}
                role="button"
                aria-label={t("editorPanels.linePanel.controlHandle", {
                  distance: formatNumber(x),
                  value: formatNumber(y),
                })}
                onPointerDown={(event) => startDrag(pointIndex, event)}
                onClick={(event) => event.stopPropagation()}
                onFocus={() => setSelected(pointIndex)}
              />
            );
          })}
        </svg>
      </div>
      <div className="line-control-axis" aria-hidden="true">
        <span>
          {t("editorPanels.linePanel.controlDistance")} {formatNumber(domain.minX)} —{" "}
          {formatNumber(domain.maxX)}
        </span>
        <span>
          {t("editorPanels.linePanel.controlValue")} {formatNumber(domain.minY)} —{" "}
          {formatNumber(domain.maxY)}
        </span>
      </div>
      {selectedPoint ? (
        <div className="line-control-points">
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor={xId}
            label={t("editorPanels.linePanel.controlDistance")}
            control={
              <Input
                key={`x:${selected}:${selectedDraft.x}`}
                id={xId}
                type="number"
                step="any"
                defaultValue={selectedDraft.x}
                onBlur={(event) => applyPointField("x", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            }
          />
          <FieldRow
            layout="inline"
            density="compact"
            htmlFor={valueId}
            label={t("editorPanels.linePanel.controlValue")}
            control={
              <Input
                key={`v:${selected}:${selectedDraft.value}`}
                id={valueId}
                type="number"
                step={track.step}
                defaultValue={selectedDraft.value}
                onBlur={(event) => applyPointField("value", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            }
          />
          <Button type="button" variant="danger" density="compact" onClick={deletePoint}>
            {t("editorPanels.linePanel.controlDeletePoint")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
