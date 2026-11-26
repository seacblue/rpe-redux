/**
 * Owns the line-info readout: when it is visible and which sampled line values
 * it shows. Text assembly lives in `lineInfoPresenter`; React only renders the
 * published snapshot.
 */
import { createValue } from "../../../../../../core/state/values.ts";
import type { SceneRuntime } from "../../../../../../core/global/chart/runtime/scene.ts";
import type { TempoMap } from "../../../../../../core/global/chart/timing/tempo.ts";
import { buildLineInfoPresentation, type LineInfoLayout } from "./lineInfoPresenter.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";

/** Published visibility, text, and structured layout of the line-info readout. */
export interface LineInfoSnapshot {
  visible: boolean;
  text: string;
  layout: LineInfoLayout;
}
/** The line-info value cell type published by the controller. */
export type LineInfoState = ReturnType<typeof createLineInfoState>;

/** Creates the value cell that holds the published readout. */
export function createLineInfoState() {
  return createValue<LineInfoSnapshot>({
    initial: { visible: false, text: "", layout: { rows: [] } },
  });
}

/**
 * Creates the readout controller that resolves the text for the current frame.
 *
 * The controller hides itself at home, without a line, or when turned off; a
 * caller supplies the clock, tempo, and optional event-list override.
 */
export function createLineInfoController(deps: {
  state: LineInfoState;
  scene: SceneRuntime;
  session: () => EditorSession;
  atHome: () => boolean;
  seconds: () => number;
  tempo: () => TempoMap;
}) {
  let visible = false;
  let previousChart: EditorSession["chart"] | null = null;
  let previousLineIndex = -1;
  let previousSeconds: number | undefined;

  /** Forget the frame history so a new subject does not look like a jump. */
  function resetFrameHistory(): void {
    previousChart = null;
    previousLineIndex = -1;
    previousSeconds = undefined;
  }

  /** Recomputes the published text, or hides the readout when it has no subject. */
  function update() {
    const session = deps.session();
    if (!visible || !session.line || deps.atHome()) {
      resetFrameHistory();
      deps.state.update({ visible: false });
      return;
    }
    const seconds = deps.seconds();
    const sameSubject = previousChart === session.chart && previousLineIndex === session.lineIndex;
    const presentation = buildLineInfoPresentation(
      deps.scene,
      session.chart,
      session.lineIndex,
      seconds,
      deps.tempo(),
      sameSubject ? previousSeconds : undefined,
    );
    deps.state.update({
      visible: true,
      text: presentation.text,
      layout: presentation.layout,
    });
    previousChart = session.chart;
    previousLineIndex = session.lineIndex;
    previousSeconds = seconds;
  }

  return {
    setVisible(value: boolean) {
      visible = value;
      if (!value) {
        resetFrameHistory();
      }
      deps.state.update({ visible: value });
    },
    toggle() {
      visible = !visible;
    },
    hide() {
      visible = false;
      resetFrameHistory();
      deps.state.update({ visible: false });
    },
    update,
  };
}
