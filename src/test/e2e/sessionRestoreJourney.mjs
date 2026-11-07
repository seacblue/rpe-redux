/**
 * Kills the packaged application, reopens the same profile, and verifies that a
 * crash restores the last document, playhead, and panel choices.
 *
 * The seek target is derived from the fixture's decoded duration so the journey
 * does not depend on a particular audio asset length.
 */
import { ensureFixtures } from "./fixtures.mjs";
import { delay, restartWithSameProfile } from "./journeySupport.mjs";
import { drawerSdkState } from "./drawerSupport.mjs";

async function waitForDocument(runner) {
  await runner.waitFor("document open", () =>
    runner.evaluate(`(() => {
      const state = window.redux.document.state();
      return state.status === 'open' && Boolean(state.path);
    })()`),
  );
}

async function playbackValue(runner, label) {
  const result = await runner.callApi("window.redux.playback.state()");
  if (!result?.ok) {
    throw new Error(`${label}: ${JSON.stringify(result)}`);
  }
  return result.value;
}

const drawerLinesOpen = (runner) =>
  runner.evaluate(`(() => {
    const inspector = document.querySelector('#inspector');
    const page = inspector?.querySelector('[data-drawer-pane="lines"]');
    const trigger = document.querySelector('.sidebar [data-drawer-pane="lines"]');
    const heading = inspector?.querySelector('.inspector-status-name')?.textContent?.trim();
    const expected = trigger?.getAttribute('aria-label')?.trim();
    return (
      inspector?.classList.contains('is-drawer') === true &&
      Boolean(page) &&
      Boolean(heading) &&
      heading === expected
    );
  })()`);

const chartInfoExpanded = (runner) =>
  runner.evaluate(
    "(() => { const node = document.querySelector('#chart-info'); return Boolean(node) && !node.hidden; })()",
  );

export async function sessionRestore(runner) {
  const paths = ensureFixtures();
  const opened = await runner.callApi(
    `window.redux.document.openPath(${JSON.stringify(paths.pez)}, { replace: "discard" })`,
  );
  if (!opened?.ok) {
    throw new Error(`fixture open failed: ${JSON.stringify(opened)}`);
  }
  await waitForDocument(runner);
  await runner.waitFor("fixture audio loaded", async () => {
    const state = await playbackValue(runner, "playback state");
    return state.loaded === true && Number.isFinite(state.duration) && (state.duration ?? 0) > 0;
  });
  const initial = await playbackValue(runner, "playback state");
  const seekTarget = Number((initial.duration / 2).toFixed(3));
  const seeked = await runner.callApi(`window.redux.playback.seek(${seekTarget})`);
  if (!seeked?.ok) {
    throw new Error(`playback seek failed: ${JSON.stringify(seeked)}`);
  }

  await runner.evaluate(`(() => {
    document.querySelector('[data-pane="history"]')?.click();
    return true;
  })()`);
  await runner.waitFor("history pane open", () =>
    runner.evaluate(
      "Boolean(document.querySelector('#inspector [data-panel=history]:not([hidden])'))",
    ),
  );
  await runner.evaluate(
    "document.querySelector('.sidebar [data-drawer-pane=lines]')?.click(); true",
  );
  await runner.waitFor("drawer lines pane open", () => drawerLinesOpen(runner));
  await runner.waitFor("chart info expanded", () => chartInfoExpanded(runner));

  // The keeper samples periodically and the preference push is debounced, so
  // give the crash snapshot one sampling window to observe the seek.
  await delay(3200);
  const restarted = await restartWithSameProfile(runner, undefined, { crash: true });
  try {
    await waitForDocument(restarted);
    await restarted.waitFor("restored playhead", () =>
      restarted.evaluate(
        `(() => {
          const result = window.redux.playback.state();
          return (
            result.ok &&
            typeof result.value.chartSeconds === 'number' &&
            Math.abs(result.value.chartSeconds - ${seekTarget}) < 0.05
          );
        })()`,
      ),
    );
    await restarted.waitFor("restored chart info", () => chartInfoExpanded(restarted));
    await restarted.waitFor("restored drawer", () => drawerLinesOpen(restarted));
    const restored = await playbackValue(restarted, "restored playback state");
    runner.assert(
      Math.abs(restored.chartSeconds - seekTarget) < 0.05,
      `restored playhead moved: ${JSON.stringify({ seekTarget, restored })}`,
    );
    runner.assert(await chartInfoExpanded(restarted), "restored chart info is collapsed");
    runner.assert(await drawerLinesOpen(restarted), "restored drawer pane is missing");
    const restoredDrawer = await drawerSdkState(restarted);
    runner.assert(
      restoredDrawer.selected === "lines" &&
        restoredDrawer.open &&
        restoredDrawer.split &&
        restoredDrawer.pane === "lines",
      `restored SDK selection and visible drawer disagree: ${JSON.stringify(restoredDrawer)}`,
    );
  } finally {
    await restarted.close();
  }
}
