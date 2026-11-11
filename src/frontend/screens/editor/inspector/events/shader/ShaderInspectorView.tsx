/**
 * The shader parameter form: one track per shader parameter, its typed fields,
 * easing, and the add/delete actions.
 *
 * Parsing and alignment come from core shader helpers; the view edits drafts and
 * sends them back as event transforms.
 */
import { useEffect, useMemo, useState } from "react";
import { InlineAlert } from "../../../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../../design/components/field/FieldRows.tsx";
import { Input } from "../../../../../../design/components/input/Input.tsx";
import { Button } from "../../../../../../design/components/button/Button.tsx";
import { compareBeats, type Beat } from "../../../../../../core/global/chart/timing/beat.ts";
import { isRecord } from "../../../../../../core/utils/guards.ts";
import { clamp } from "../../../../../../core/utils/numbers.ts";
import {
  alignShaderTrack,
  parseShaderValue,
  shaderIdentity,
  shaderParameterTrack,
  shaderTypeFields,
} from "../../../../../../core/global/chart/shader/shaderEvents.ts";
import type { JudgeLineEvent } from "../../../../../../core/global/chart/chart.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import { SHADER_NAMES } from "../../../../../../core/global/chart/shader/shader.ts";
import { shaderAssetPath } from "../../../../../../core/global/chart/shader/shader.ts";
import type { ShaderVarTrack } from "../../../../../../core/global/chart/shader/sampling.ts";
import { EasingField } from "../../../../../../design/components/easing/EasingField.tsx";
import { EasingPreview } from "../../../../../../design/components/easing/EasingPreview.tsx";
import { t } from "../../../../../../i18n/index.ts";
import { requestConfirm } from "../../../../../overlays/modals/prompts.ts";
import { Field, BeatControl, SelectField } from "./ShaderPanelFields.tsx";
import type { SelectOption } from "./ShaderPanelFields.tsx";

/** One parameter declared by a shader source. */
export interface ShaderDefinition {
  name: string;
  dimensions: number;
  value: unknown;
  label?: string;
}

/** Per-session UI state preserved across inspector re-renders. */
export interface ShaderInspectorState {
  selection: string;
  parameter: string;
  open: boolean;
}

/** Props supplied by the shader inspector presenter. */
export interface ShaderInspectorViewProps {
  event: JudgeLineEvent;
  session: EditorSession;
  state: ShaderInspectorState;
  reportError(error: unknown): void;
  refresh(): void;
  parametersFor(
    shader: string,
    source: string,
    chart?: EditorSession["chart"],
  ): Promise<ShaderDefinition[]>;
  shaderOptions: readonly string[];
  setParameter(value: string): void;
  setOpen(value: boolean): void;
  setLiveEventEdit(active: boolean): void;
  setAutoAlign(active: boolean): void;
  change(label: string, transform: (current: JudgeLineEvent) => JudgeLineEvent): void;
}

/** Returns the event's shader variable map. */
function eventVars(event: JudgeLineEvent): Record<string, unknown> {
  return isRecord(event.vars) ? event.vars : {};
}

/** Reads parameter definitions from the values the event already stores. */
function definitionsFromEvent(event: JudgeLineEvent): ShaderDefinition[] {
  return Object.entries(eventVars(event)).map(([name, value]) => {
    const sample = Array.isArray(value) && typeof value[0] === "object" ? value[0].start : value;
    return { name, dimensions: Array.isArray(sample) ? sample.length : 1, value: sample };
  });
}

/** Renders one shader event's parameters, segments, and actions. */
export function ShaderInspectorView({
  event,
  session,
  state,
  reportError,
  refresh,
  parametersFor,
  shaderOptions,
  setParameter,
  setOpen,
  setLiveEventEdit,
  setAutoAlign,
  change,
}: ShaderInspectorViewProps) {
  const [loaded, setLoaded] = useState<{
    identity: string;
    definitions: ShaderDefinition[];
    failure: string;
  }>({ identity: "", definitions: [], failure: "" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [parameterState, setParameterState] = useState(state.parameter);
  const [openState, setOpenState] = useState(state.open);
  // The beat the parameter track snaps to; the boxes own the value they commit.
  const [alignTarget, setAlignTarget] = useState<Beat>(() => event.startTime);
  const identity = shaderIdentity(event);
  const shaderSource = String(event.shader ?? "");
  const loadedDefinitions = useMemo(
    () => (loaded.identity === identity ? loaded.definitions : []),
    [identity, loaded],
  );
  const loadFailure = loaded.identity === identity ? loaded.failure : "";
  const loading = loaded.identity !== identity;
  const definitions = useMemo(() => {
    const existing = definitionsFromEvent(event);
    // A successful source load is authoritative: the asset-library selection
    // must be able to hide an old event variable instead of adding it back.
    if (!loading && !loadFailure && loaded.identity === identity) {
      return loadedDefinitions;
    }
    return [
      ...loadedDefinitions,
      ...existing.filter((entry) => !loadedDefinitions.some((item) => item.name === entry.name)),
    ];
  }, [event, identity, loaded, loadedDefinitions, loadFailure, loading]);
  const parameter = definitions.some((entry) => entry.name === parameterState)
    ? parameterState
    : (definitions[0]?.name ?? "");
  const definition = definitions.find((entry) => entry.name === parameter);
  const track = definition ? shaderParameterTrack(event, definition.name, definition.value) : [];
  const customShader = shaderAssetPath(identity);
  const assetNames = [...new Set([...shaderOptions, ...(customShader ? [customShader] : [])])].sort(
    (left, right) => left.localeCompare(right),
  );
  const assetGroups = new Map<string, SelectOption[]>();
  for (const name of assetNames) {
    const slash = name.lastIndexOf("/");
    const folder = slash > 0 ? name.slice(0, slash) : "";
    const group = folder
      ? t("editorPanels.inspector.shader.libraryFolderGroup", { folder })
      : t("editorPanels.inspector.shader.libraryGroup");
    const entries = assetGroups.get(group) ?? [];
    entries.push({ value: name, label: name, group });
    assetGroups.set(group, entries);
  }
  const shaderChoices: SelectOption[] = [
    ...SHADER_NAMES.map((name) => ({
      value: name,
      label: name,
      group: t("editorPanels.inspector.shader.builtinGroup"),
    })),
    ...[...assetGroups.entries()].flatMap(([, entries]) => entries),
  ];

  useEffect(() => {
    let active = true;
    parametersFor(identity, shaderSource, session.chart)
      .then((result) => {
        if (active) {
          setLoaded({ identity, definitions: result, failure: "" });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoaded({
            identity,
            definitions: [],
            failure: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [identity, loadAttempt, parametersFor, session.chart, shaderSource]);

  const safely = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      reportError(error);
    }
  };
  const updateTrack = (
    label: string,
    transform: (segments: ShaderVarTrack) => ShaderVarTrack,
  ): void => {
    if (!definition) {
      return;
    }
    change(label, (current) => {
      const next = transform(
        structuredClone(shaderParameterTrack(current, definition.name, definition.value)),
      );
      for (const segment of next) {
        if (compareBeats(segment.endTime, segment.startTime) < 0) {
          throw new Error(t("editorPanels.inspector.shader.segmentRange"));
        }
      }
      return { ...current, vars: { ...eventVars(current), [definition.name]: next } };
    });
  };
  const commitInput = (
    apply: (text: string) => void,
    input: HTMLInputElement,
    text: string,
    quiet: boolean,
  ): void => {
    try {
      apply(text);
      input.setCustomValidity("");
    } catch (error) {
      input.setCustomValidity(error instanceof Error ? error.message : String(error));
      if (!quiet) {
        reportError(error);
      }
    }
  };
  const input = (
    title: string,
    value: string | number,
    apply: (text: string) => void,
    options: { kind?: string; step?: number; min?: number; max?: number } = {},
  ) => (
    <Field
      key={title}
      title={title}
      value={value}
      kind={options.kind}
      step={options.step}
      min={options.min}
      max={options.max}
      session={session}
      setLiveEventEdit={setLiveEventEdit}
      refresh={refresh}
      apply={(text, quiet, input) => {
        commitInput(apply, input, text, quiet);
      }}
    />
  );
  const beatInput = (
    title: string,
    value: Beat,
    onCommit: (beat: Beat) => void,
    options: { accepts?: (beat: Beat) => boolean; dataField?: string } = {},
  ) => (
    <BeatControl
      key={title}
      title={title}
      value={value}
      division={session.division || 4}
      accepts={options.accepts}
      dataField={options.dataField}
      session={session}
      setLiveEventEdit={setLiveEventEdit}
      refresh={refresh}
      reportError={reportError}
      onCommit={(beat) => {
        // The track rejects a segment range it cannot represent; the field then
        // shows its prior value and the failed edit never becomes that value.
        try {
          onCommit(beat);
          return true;
        } catch (error) {
          reportError(error);
          return false;
        }
      }}
    />
  );

  return (
    <div className="shader-inspector">
      <FieldRows>
        {beatInput(
          t("editorPanels.inspector.field.startTime"),
          event.startTime,
          (startTime) => {
            change(
              t("editorPanels.inspector.shader.modify", {
                field: t("editorPanels.inspector.field.startTime"),
              }),
              (current) => ({
                ...current,
                startTime,
              }),
            );
          },
          { dataField: "startTime" },
        )}
        {beatInput(
          t("editorPanels.inspector.field.endTime"),
          event.endTime,
          (endTime) => {
            change(
              t("editorPanels.inspector.shader.modify", {
                field: t("editorPanels.inspector.field.endTime"),
              }),
              (current) => ({
                ...current,
                endTime,
              }),
            );
          },
          { dataField: "endTime" },
        )}
        <SelectField
          title={t("editorPanels.inspector.field.type")}
          value={identity}
          options={shaderChoices}
          onChange={(name) =>
            safely(() => {
              setParameterState("");
              setParameter("");
              setOpenState(false);
              setOpen(false);
              change(t("editorPanels.inspector.shader.modifyType"), (current) => ({
                ...current,
                ...(shaderAssetPath(name)
                  ? { shader: name, clone: false }
                  : shaderTypeFields(name)),
                vars: {},
              }));
            })
          }
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.inspector.shader.global")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={Boolean(event.global)}
              onChange={(changeEvent) =>
                safely(() =>
                  change(t("editorPanels.inspector.shader.modifyGlobal"), (current) => ({
                    ...current,
                    global: changeEvent.currentTarget.checked,
                  })),
                )
              }
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.inspector.shader.autoAlign")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={session.shaderAutoAlign !== false}
              onChange={(changeEvent) => {
                setAutoAlign(changeEvent.currentTarget.checked);
              }}
            />
          )}
        />
        {input(
          t("editorPanels.inspector.shader.order"),
          Number(event.order ?? 0),
          (text) => {
            if (!text.trim() || !Number.isFinite(Number(text))) {
              throw new Error(t("editorPanels.inspector.shader.orderNumber"));
            }
            const value = clamp(Math.round(Number(text)), 0, 10000);
            change(t("editorPanels.inspector.shader.modifyOrder"), (current) => ({
              ...current,
              order: value,
            }));
          },
          { kind: "number", step: 1, min: 0, max: 10000 },
        )}
      </FieldRows>
      {loading && (
        <p className="hint shader-loading" role="status">
          {t("editorPanels.inspector.shader.loading")}
        </p>
      )}
      {loadFailure && (
        <InlineAlert
          action={
            <Button variant="outlined" onClick={() => setLoadAttempt((value) => value + 1)}>
              {t("common.action.retry")}
            </Button>
          }
        >
          {t("editorPanels.inspector.shader.loadFailedMessage", { message: loadFailure })}
        </InlineAlert>
      )}
      <SelectField
        title={t("editorPanels.inspector.shader.parameters")}
        value={parameter}
        options={definitions.map(({ name, label }) => ({
          value: name,
          label: label?.trim() || name,
        }))}
        disabled={!definitions.length}
        onChange={(name) => {
          setParameterState(name);
          setParameter(name);
        }}
      />
      <Button
        type="button"
        variant="outlined"
        className="wide-button"
        aria-expanded={openState}
        disabled={!definitions.length}
        onClick={() => {
          setOpenState(!openState);
          setOpen(!openState);
        }}
      >
        {openState
          ? t("editorPanels.inspector.shader.collapse")
          : t("editorPanels.inspector.shader.expand")}
      </Button>
      {openState && definition && (
        <div className="shader-parameter-editor">
          <BeatControl
            title={t("editorPanels.inspector.shader.alignToBeat")}
            value={alignTarget}
            division={session.division || 4}
            dataField="alignToBeat"
            session={session}
            setLiveEventEdit={setLiveEventEdit}
            refresh={refresh}
            reportError={reportError}
            onCommit={setAlignTarget}
          />
          <Button
            type="button"
            variant="outlined"
            className="wide-button"
            onClick={() =>
              safely(() => {
                updateTrack(t("editorPanels.inspector.shader.alignLabel"), (segments) =>
                  alignShaderTrack(segments, alignTarget),
                );
              })
            }
          >
            {t("editorPanels.inspector.shader.alignToStart")}
          </Button>
          {track.map((segment, index) => {
            const fields: ["startTime" | "endTime" | "start" | "end", string][] = [
              ["startTime", t("editorPanels.inspector.field.startTime")],
              ["endTime", t("editorPanels.inspector.field.endTime")],
              ["start", t("editorPanels.inspector.shader.segmentStart")],
              ["end", t("editorPanels.inspector.shader.segmentEnd")],
            ];
            return (
              <section className="shader-segment" key={index}>
                <strong>
                  {t("editorPanels.inspector.shader.segmentTitle", {
                    name: definition.label?.trim() || definition.name,
                    index: index + 1,
                  })}
                </strong>
                <FieldRows>
                  {fields.map(([key, fieldTitle]) => {
                    if (key === "startTime" || key === "endTime") {
                      const segmentStart = segment.startTime;
                      const segmentEnd = segment.endTime;
                      return beatInput(
                        t("editorPanels.inspector.shader.parameterField", { field: fieldTitle }),
                        segment[key] as Beat,
                        (beat) => {
                          updateTrack(
                            t("editorPanels.inspector.shader.modifyParameter", {
                              field: fieldTitle,
                            }),
                            (segments) =>
                              segments.map((entry, position) =>
                                position === index ? { ...entry, [key]: beat } : entry,
                              ),
                          );
                        },
                        // The parameter's end cannot precede its start.
                        key === "endTime"
                          ? {
                              accepts: (beat) => compareBeats(beat, segmentStart) >= 0,
                              dataField: key,
                            }
                          : {
                              accepts: (beat) => compareBeats(segmentEnd, beat) >= 0,
                              dataField: key,
                            },
                      );
                    }
                    const raw = segment[key];
                    const isArray = Array.isArray(raw);
                    return input(
                      t("editorPanels.inspector.shader.parameterField", { field: fieldTitle }),
                      isArray ? raw.join(", ") : typeof raw === "number" ? raw : String(raw ?? ""),
                      (text) => {
                        const value = parseShaderValue(text, definition.dimensions);
                        updateTrack(
                          t("editorPanels.inspector.shader.modifyParameter", { field: fieldTitle }),
                          (segments) =>
                            segments.map((entry, position) =>
                              position === index ? { ...entry, [key]: value } : entry,
                            ),
                        );
                      },
                      {
                        kind: definition.dimensions === 1 ? "number" : "text",
                      },
                    );
                  })}
                  <EasingField
                    label={t("editorPanels.inspector.shader.parameterEasing")}
                    value={Number(segment.easingType ?? 1)}
                    onChange={(easing) =>
                      safely(() => {
                        updateTrack(
                          t("editorPanels.inspector.shader.modifyParameterEasing"),
                          (entries) =>
                            entries.map((entry, position) =>
                              position === index ? { ...entry, easingType: easing } : entry,
                            ),
                        );
                      })
                    }
                  />
                </FieldRows>
                <EasingPreview event={segment} />
                <Button
                  type="button"
                  variant="danger"
                  className="wide-button"
                  disabled={track.length <= 1}
                  onClick={() =>
                    void requestConfirm({
                      title: t("editorPanels.inspector.shader.removeSegment"),
                      description: t("editorPanels.inspector.shader.removeSegmentConfirm"),
                      label: t("editorPanels.inspector.shader.removeSegment"),
                      cancelLabel: t("common.action.cancel"),
                      destructive: true,
                    }).then((accepted) => {
                      if (!accepted) {
                        return;
                      }
                      safely(() =>
                        updateTrack(
                          t("editorPanels.inspector.shader.removeSegmentLabel"),
                          (entries) => entries.filter((_, position) => position !== index),
                        ),
                      );
                    })
                  }
                >
                  {t("editorPanels.inspector.shader.removeSegment")}
                </Button>
              </section>
            );
          })}
          <Button
            type="button"
            variant="outlined"
            className="wide-button"
            onClick={() =>
              safely(() =>
                updateTrack(t("editorPanels.inspector.shader.addSegmentLabel"), (segments) => {
                  const last = segments.at(-1);
                  if (!last) {
                    return segments;
                  }
                  return [
                    ...segments,
                    {
                      startTime: last.endTime,
                      endTime: last.endTime,
                      start: structuredClone(last.end),
                      end: structuredClone(last.end),
                      easingType: last.easingType ?? 1,
                    },
                  ];
                }),
              )
            }
          >
            {t("editorPanels.inspector.shader.addSegment")}
          </Button>
        </div>
      )}
    </div>
  );
}
