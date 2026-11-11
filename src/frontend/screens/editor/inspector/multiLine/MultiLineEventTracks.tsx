/**
 * The multi-line event-track switches: one chip per ordinary track, with the X
 * and Y chips replaced by one XY chip while global XY binding is enabled.
 *
 * The component owns only presentation switches and their transitions. The
 * timeline's column resolver and selection pruning read the same persisted
 * values, so a hidden track has no column to click and no key left in the
 * selection.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { FieldRows } from "../../../../../design/components/field/FieldRows.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { parseEventKey } from "../../../../../core/edit/events/eventTracks.ts";
import type { EditorSession } from "../../../../../core/edit/session/session.ts";
import { t } from "../../../../../i18n/index.ts";
import { displayValues } from "../../../settings/editorDisplaySettings.ts";
import { useSetting } from "../../../settings/useSetting.ts";
import type { Timeline } from "../../workspace/timeline/surface/timeline.ts";
import { visibleEventTypesForLine } from "../../workspace/timeline/events/eventColumns.ts";

const CONTROLLED_EVENT_TYPES = new Set([
  "moveXEvents",
  "moveYEvents",
  "rotateEvents",
  "alphaEvents",
  "speedEvents",
]);

/** Drop selections that point at ordinary tracks hidden by the event switches. */
function pruneHiddenEventSelection(session: EditorSession): void {
  const lineIndices = session.multiLineActive ? session.targetLineIndices : [session.lineIndex];
  const visibleByLine = new Map(
    lineIndices.map((lineIndex) => [
      lineIndex,
      new Set(visibleEventTypesForLine(session, lineIndex, false)),
    ]),
  );
  const prune = (selection: Set<string> | undefined, lineIndex: number) => {
    if (!selection?.size) {
      return;
    }
    const visible = visibleByLine.get(lineIndex);
    for (const key of selection) {
      const parsed = parseEventKey(key);
      if (parsed && CONTROLLED_EVENT_TYPES.has(parsed.type) && !visible?.has(parsed.type)) {
        selection.delete(key);
      }
    }
  };
  prune(session.eventSelection, session.lineIndex);
  for (const [lineIndex, selection] of session.multiEventSelection) {
    prune(selection, lineIndex);
  }
}

export interface MultiLineEventTracksProps {
  session: EditorSession;
  timeline: Pick<Timeline, "changed" | "cancelPlacement"> | null;
  renderSession: () => void;
}

/** Renders the five event switches, or the merged XY switch under binding. */
export function MultiLineEventTracks({
  session,
  timeline,
  renderSession,
}: MultiLineEventTracksProps) {
  const showXEvents = useSyncExternalStore(
    displayValues.multiLineEventShowX.subscribe,
    displayValues.multiLineEventShowX.get,
    displayValues.multiLineEventShowX.get,
  );
  const showYEvents = useSyncExternalStore(
    displayValues.multiLineEventShowY.subscribe,
    displayValues.multiLineEventShowY.get,
    displayValues.multiLineEventShowY.get,
  );
  const showRotateEvents = useSyncExternalStore(
    displayValues.multiLineEventShowRotate.subscribe,
    displayValues.multiLineEventShowRotate.get,
    displayValues.multiLineEventShowRotate.get,
  );
  const showAlphaEvents = useSyncExternalStore(
    displayValues.multiLineEventShowAlpha.subscribe,
    displayValues.multiLineEventShowAlpha.get,
    displayValues.multiLineEventShowAlpha.get,
  );
  const showSpeedEvents = useSyncExternalStore(
    displayValues.multiLineEventShowSpeed.subscribe,
    displayValues.multiLineEventShowSpeed.get,
    displayValues.multiLineEventShowSpeed.get,
  );
  const xyBinding = useSetting("xy-binding", false);
  const xyVisible = showXEvents || showYEvents;
  const previousXYBinding = useRef(xyBinding);

  // Binding is a presentation switch over the same two persisted flags. Turning
  // it on merges the pair with OR; turning it off writes that merged state back
  // to both axes so the visible set does not jump. While binding stays on, the
  // raw pair is normalized on mount so a later disable can distribute it even
  // when the settings page changed the binding without this pane mounted.
  useEffect(() => {
    const transitioned = previousXYBinding.current !== xyBinding;
    previousXYBinding.current = xyBinding;
    if (!xyBinding && !transitioned) {
      return;
    }
    const x = displayValues.multiLineEventShowX.get();
    const y = displayValues.multiLineEventShowY.get();
    const axes = x || y;
    if (x !== axes) {
      displayValues.multiLineEventShowX.set(axes);
    }
    if (y !== axes) {
      displayValues.multiLineEventShowY.set(axes);
    }
    if (!transitioned && x === axes && y === axes) {
      return;
    }
    pruneHiddenEventSelection(session);
    timeline?.cancelPlacement();
    timeline?.changed();
    renderSession();
  }, [renderSession, session, timeline, xyBinding]);

  if (session.multiLineMode !== "events") {
    return null;
  }

  /** Writes one display switch and repaints the event field. */
  const setEventTrackVisible = (
    track: "x" | "y" | "rotate" | "alpha" | "speed",
    enabled: boolean,
  ) => {
    if (xyBinding && (track === "x" || track === "y")) {
      displayValues.multiLineEventShowX.set(enabled);
      displayValues.multiLineEventShowY.set(enabled);
    } else if (track === "x") {
      displayValues.multiLineEventShowX.set(enabled);
    } else if (track === "y") {
      displayValues.multiLineEventShowY.set(enabled);
    } else if (track === "rotate") {
      displayValues.multiLineEventShowRotate.set(enabled);
    } else if (track === "alpha") {
      displayValues.multiLineEventShowAlpha.set(enabled);
    } else {
      displayValues.multiLineEventShowSpeed.set(enabled);
    }
    pruneHiddenEventSelection(session);
    timeline?.cancelPlacement();
    timeline?.changed();
    renderSession();
  };

  return (
    <div
      className="multi-line-event-tracks-block"
      role="group"
      aria-label={t("editorPanels.multiLine.eventTracks")}
    >
      <span className="multi-line-event-tracks-label">
        {t("editorPanels.multiLine.eventTracks")}
      </span>
      <FieldRows>
        {xyBinding ? (
          <FieldRow
            layout="inline"
            density="compact"
            label={t("editorPanels.multiLine.showXY")}
            control={(id) => (
              <Input
                id={id}
                type="checkbox"
                checked={xyVisible}
                onChange={(event) => setEventTrackVisible("x", event.currentTarget.checked)}
              />
            )}
          />
        ) : (
          <>
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.multiLine.showX")}
              control={(id) => (
                <Input
                  id={id}
                  type="checkbox"
                  checked={showXEvents}
                  onChange={(event) => setEventTrackVisible("x", event.currentTarget.checked)}
                />
              )}
            />
            <FieldRow
              layout="inline"
              density="compact"
              label={t("editorPanels.multiLine.showY")}
              control={(id) => (
                <Input
                  id={id}
                  type="checkbox"
                  checked={showYEvents}
                  onChange={(event) => setEventTrackVisible("y", event.currentTarget.checked)}
                />
              )}
            />
          </>
        )}
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.multiLine.showRotate")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={showRotateEvents}
              onChange={(event) => setEventTrackVisible("rotate", event.currentTarget.checked)}
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.multiLine.showAlpha")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={showAlphaEvents}
              onChange={(event) => setEventTrackVisible("alpha", event.currentTarget.checked)}
            />
          )}
        />
        <FieldRow
          layout="inline"
          density="compact"
          label={t("editorPanels.multiLine.showSpeed")}
          control={(id) => (
            <Input
              id={id}
              type="checkbox"
              checked={showSpeedEvents}
              onChange={(event) => setEventTrackVisible("speed", event.currentTarget.checked)}
            />
          )}
        />
      </FieldRows>
    </div>
  );
}
