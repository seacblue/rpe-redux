/**
 * Runs one session publication in the observable order: data, readouts, panel
 * contents, then selection routing. The document provider owns when a publish
 * happens; this module only sequences the feature-owned steps.
 */
import {
  createSessionData,
  type SessionDataOptions,
  type SessionPresentationData,
} from "./sessionData.ts";
import { createSessionReadouts, type SessionReadoutOptions } from "./sessionReadouts.ts";
import { createSessionPanels, type SessionPanelOptions } from "./sessionPanels.ts";
import { createSessionSelection, type SessionSelectionOptions } from "./sessionSelection.ts";

/** Options for one observable session publication. */
export interface SessionRendererOptions {
  data: SessionDataOptions;
  readouts: SessionReadoutOptions;
  panels: SessionPanelOptions;
  selection: SessionSelectionOptions;
  activePane(): string;
  invalidate(): void;
}

/** Timings for the synchronous parts of one session publication. */
export interface SessionRenderTiming {
  readonly durationMs: number;
  readonly dataMs: number;
  readonly readoutsMs: number;
  readonly panelsMs: number;
  readonly selectionMs: number;
  readonly invalidateMs: number;
}

/** This order is observable: data → readouts → panel contents → selection routing. */
export function createEditorSessionRenderer(options: SessionRendererOptions) {
  const data = createSessionData(options.data);
  const readouts = createSessionReadouts(options.readouts);
  const panels = createSessionPanels(options.panels);
  const selection = createSessionSelection(options.selection);
  let lastPresentation: SessionPresentationData | undefined;
  /** Runs one publication in its observable order. */
  function render(): SessionRenderTiming {
    const started = performance.now();
    let phaseStarted = started;
    const activePane = options.activePane();
    const current = data.prepare();
    lastPresentation = current;
    const dataMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    readouts.publish(current.session);
    const readoutsMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    panels.refresh(current.session, current.tempo, activePane);
    const panelsMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    selection.route(current.session, activePane);
    const selectionMs = performance.now() - phaseStarted;
    phaseStarted = performance.now();
    options.invalidate();
    const invalidateMs = performance.now() - phaseStarted;
    return {
      durationMs: performance.now() - started,
      dataMs,
      readoutsMs,
      panelsMs,
      selectionMs,
      invalidateMs,
    };
  }
  /** Refresh selection-owned UI without repeating document synchronization work. */
  function renderSelection(): SessionRenderTiming {
    const started = performance.now();
    const activePane = options.activePane();
    const cached = lastPresentation;
    const liveSession = options.data.session();
    const current = cached?.session === liveSession ? cached : data.prepare();
    lastPresentation = current;
    const dataMs = cached ? 0 : performance.now() - started;
    const readoutsMs = 0;
    const panelsStarted = performance.now();
    panels.refreshSelection(current.session, current.tempo, activePane);
    const panelsMs = performance.now() - panelsStarted;
    const selectionStarted = performance.now();
    selection.route(current.session, activePane);
    const selectionMs = performance.now() - selectionStarted;
    const invalidateStarted = performance.now();
    options.invalidate();
    const invalidateMs = performance.now() - invalidateStarted;
    return {
      durationMs: performance.now() - started,
      dataMs,
      readoutsMs,
      panelsMs,
      selectionMs,
      invalidateMs,
    };
  }
  return {
    render,
    renderSelection,
    chartInfoPresenter: readouts.chartInfoPresenter,
    resetSelectionRouting: selection.reset,
    dispose: readouts.dispose,
  };
}
