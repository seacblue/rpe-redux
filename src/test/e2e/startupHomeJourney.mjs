/**
 * Restarting the application never reopens a chart.
 *
 * The previous run leaves nothing a later launch can act on, so a clean exit and
 * a crash with a chart open both come back to the chart library with an empty
 * document. Only an address or an explicit open installs one.
 */
import { ensureFixtures } from "./fixtures.mjs";
import { assertHomeScreen, delay, restartWithSameProfile } from "./journeySupport.mjs";

const isEmpty = (runner) => runner.evaluate("window.redux.document.state().status === 'empty'");

/** Waits for the empty home screen and asserts it owns the window. */
async function waitForEmptyHome(runner, label) {
  await runner.waitFor(label, () => isEmpty(runner));
  await assertHomeScreen(runner);
}

/** Opens the fixture chart through the public API. */
async function openFixture(runner) {
  const paths = ensureFixtures();
  const opened = await runner.callApi(
    `window.redux.document.openPath(${JSON.stringify(paths.pez)}, { replace: "discard" })`,
  );
  if (!opened?.ok) {
    throw new Error(`fixture open failed: ${JSON.stringify(opened)}`);
  }
  await runner.waitFor("fixture document open", () =>
    runner.evaluate(`(() => {
      const state = window.redux.document.state();
      return state.status === 'open' && Boolean(state.path);
    })()`),
  );
}

export async function startupHome(runner) {
  // The contract group starts with the shared fixture chart already open, which
  // is the state a restart used to reopen.
  runner.assert(
    await runner.evaluate("window.redux.document.state().status === 'open'"),
    "the startup chart was not open before the restart",
  );

  // A clean exit leaves nothing behind, so the next launch starts on the library.
  const clean = await restartWithSameProfile(runner);
  await waitForEmptyHome(clean, "home after a clean restart");

  // Reopen a chart, let it run past the interval the old sampler used, then kill
  // the process. The profile keeps whatever the run wrote, so this is the case
  // that used to restore the chart.
  await openFixture(clean);
  await delay(2500);
  const crashed = await restartWithSameProfile(clean, undefined, { crash: true });
  await waitForEmptyHome(crashed, "home after a crash with a chart open");
  await crashed.screenshot("startup-home");
  await crashed.close();
}
