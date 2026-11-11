/**
 * Shared helpers for the P0 smoke scenarios: canonical fixture setup and
 * teardown, public state readers, and the home-screen assertion.
 */

import { canonicalChart, chartSemantics } from "./fixtures.mjs";
import { SmokeRunner } from "./runner.mjs";

/** Wait for a fixed interval; used by the transport assertion. */
export function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Close the caller's runner and return a fresh one on the same profile. */
export async function restartWithSameProfile(runner, beforeStart, { crash = false } = {}) {
  const profileDir = runner.profileDir;
  runner.assert(Boolean(profileDir), "profile restart needs an owned profile directory");
  // Crash recovery keeps the last periodic sample; a clean close clears it.
  await runner.close({ preserveProfile: true, crash });
  await beforeStart?.(profileDir);
  const restarted = new SmokeRunner({ profileDir });
  try {
    await restarted.start();
  } catch (error) {
    await restarted.close().catch(() => undefined);
    throw error;
  }
  return restarted;
}

const EXPECTED = {
  lines: 3,
  notes: 6,
  events: 15,
  bpmEntries: 2,
};

/** JSON expression for a value passed into a page evaluate. */
export function expression(value) {
  return JSON.stringify(value);
}

/** Unwrap the public API's shared result envelope in smoke assertions. */
function valueOf(result) {
  if (!result?.ok) {
    throw new Error(`API call failed: ${JSON.stringify(result)}`);
  }
  return result.value;
}

/** Public document and chart snapshot shared by the document journeys. */
export function readStateExpression() {
  return `(() => {
    const value = (result) => {
      if (!result?.ok) throw new Error(JSON.stringify(result));
      return result.value;
    };
    return {
      document: window.redux.document.state(),
      fingerprint: window.redux.document.state().fingerprint,
      chart: value(window.redux.chart.snapshot()),
      metadata: value(window.redux.chart.metadata()),
      resources: value(window.redux.chart.resources()),
      lines: value(window.redux.chart.lines()),
      notes: value(window.redux.chart.notes()),
      events: value(window.redux.chart.events()),
    };
  })()`;
}

/** Assert the canonical fixture's line, note, event, and BPM counts. */
export function assertCanonical(runner, state, label) {
  const actual = chartSemantics(state.chart);
  runner.assert(actual.lines === EXPECTED.lines, `${label}: line count is ${actual.lines}`);
  runner.assert(actual.notes === EXPECTED.notes, `${label}: note count is ${actual.notes}`);
  runner.assert(actual.events === EXPECTED.events, `${label}: event count is ${actual.events}`);
  runner.assert(
    actual.bpmEntries === EXPECTED.bpmEntries,
    `${label}: BPM count is ${actual.bpmEntries}`,
  );
  runner.assert(state.lines.length === EXPECTED.lines, `${label}: chart.lines is incomplete`);
  runner.assert(state.notes.length === EXPECTED.notes, `${label}: chart.notes is incomplete`);
  runner.assert(state.events.length === EXPECTED.events, `${label}: chart.events is incomplete`);
}

/** Create the canonical fixture and wait for the loading surface to close. */
export async function createCanonical(runner, name) {
  const { chart, ids } = canonicalChart();
  const result = await runner.callApi(
    `window.redux.document.create(${expression({ name, chart, replace: "discard" })})`,
  );
  runner.assert(result.ok === true, `${name}: create failed: ${JSON.stringify(result)}`);
  await runner.waitFor("chart loading modal close", () =>
    runner.evaluate(
      "!document.querySelector('dialog.redux-chart-loading[open]') && !document.querySelector('.redux-modal-scrim')",
    ),
  );
  return { chart, ids, result };
}

/** Close the open document and assert the editor returned to empty. */
export async function closeDocument(runner) {
  const result = await runner.callApi('window.redux.document.close({ replace: "discard" })');
  runner.assert(result.ok === true, `document close failed: ${JSON.stringify(result)}`);
  runner.assert(
    (await runner.callApi("window.redux.document.state()")).status === "empty",
    "closing a document did not return to the empty state",
  );
}

export async function assertAudioTransport(runner) {
  await runner.waitFor("audio decoded", async () => {
    const state = valueOf(await runner.callApi("window.redux.playback.state()"));
    return state.loaded === true && Number.isFinite(state.duration) && state.duration > 0;
  });
  const audio = valueOf(await runner.callApi("window.redux.playback.state()"));
  runner.assert(
    audio.loaded === true && Number.isFinite(audio.duration) && audio.duration > 0,
    `audio did not decode to a usable duration: ${JSON.stringify(audio)}`,
  );
  const seekTarget = Number((audio.duration / 2).toFixed(3));
  const seeked = valueOf(await runner.callApi(`window.redux.playback.seek(${seekTarget})`));
  runner.assert(
    Math.abs(seeked.chartSeconds - seekTarget) < 0.001,
    `audio seek did not reach its target: ${JSON.stringify({ seekTarget, seeked })}`,
  );
  const slow = valueOf(await runner.callApi("window.redux.playback.setRate(0.25)"));
  runner.assert(
    Math.abs(slow.rate - 0.25) < 1e-9 && Math.abs(slow.chartSeconds - seeked.chartSeconds) < 1e-9,
    `slow playback changed position or rate: ${JSON.stringify({ seeked, slow })}`,
  );
  const restored = valueOf(await runner.callApi("window.redux.playback.setRate(1)"));
  runner.assert(
    Math.abs(restored.rate - 1) < 1e-9 &&
      Math.abs(restored.chartSeconds - seeked.chartSeconds) < 1e-9,
    `restoring 1x changed the playback position: ${JSON.stringify({ seeked, restored })}`,
  );
  // Any rate, not just the toolbar presets, must feed the time-stretcher path.
  const runFrom = Number((audio.duration / 4).toFixed(3));
  valueOf(await runner.callApi(`window.redux.playback.seek(${runFrom})`));
  valueOf(await runner.callApi("window.redux.playback.setRate(0.33)"));
  valueOf(await runner.callApi("window.redux.playback.play()"));
  await delay(320);
  const running = valueOf(await runner.callApi("window.redux.playback.state()"));
  valueOf(await runner.callApi("window.redux.playback.pause()"));
  runner.assert(
    running.playing === true && running.chartSeconds > runFrom + 0.02,
    `arbitrary-rate time-stretched playback did not advance: ${JSON.stringify({ runFrom, running })}`,
  );
  valueOf(await runner.callApi("window.redux.playback.setRate(1)"));
  valueOf(await runner.callApi("window.redux.playback.seek(0)"));
}

export async function assertHomeScreen(runner) {
  await runner.waitFor("home restored after close", () =>
    runner.evaluate(
      "document.querySelector('.redux-app-shell')?.dataset.atHome === 'true' && document.querySelector('#home')?.hidden === false && getComputedStyle(document.querySelector('.workbench')).display === 'none'",
    ),
  );
  const home = await runner.evaluate(`(() => {
    const display = (selector) => {
      const node = document.querySelector(selector);
      return node ? getComputedStyle(node).display : 'missing';
    };
    const home = document.querySelector('#home');
    const homeRect = home?.getBoundingClientRect();
    const titleRect = document.querySelector('.redux-titlebar')?.getBoundingClientRect();
    return {
      homeDisplay: display('#home'),
      workbenchDisplay: display('.workbench'),
      toolbarDisplay: display('.redux-toolbar'),
      footerDisplay: display('footer'),
      homeTop: homeRect?.top ?? -1,
      homeWidth: homeRect?.width ?? 0,
      titleBottom: titleRect?.bottom ?? -1,
      viewportWidth: innerWidth,
    };
  })()`);
  runner.assert(
    home.homeDisplay !== "none" &&
      home.workbenchDisplay === "none" &&
      home.toolbarDisplay === "none" &&
      home.footerDisplay === "none" &&
      Math.abs(home.homeTop - home.titleBottom) < 0.5 &&
      home.homeWidth >= home.viewportWidth - 1,
    `home screen does not own the window below the title bar: ${JSON.stringify(home)}`,
  );
}
