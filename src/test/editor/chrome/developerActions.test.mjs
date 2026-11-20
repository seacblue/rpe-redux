/**
 * The performance monitor is a developer surface.
 *
 * No host opens the developer section on its own: a release build reports false
 * from the host, and the development server starts closed too, so the About-page
 * gesture is the only way in. While the section is closed the monitor's switch
 * refuses to move and the monitor stays hidden; once the gesture opens the
 * section, F3 and the settings checkbox reach the same owner and the monitor
 * renders.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { registerDeveloperActions } from "../../../frontend/chrome/topbar/actions/developerActions.ts";
import { developerMode } from "../../../core/platform/desktop/developer.ts";
import { actionAvailable, runAction, toolbar } from "../../../core/shell/registries/toolbar.ts";
import { developerReveal } from "../../../core/state/developerReveal.ts";
import {
  isPerformanceHudVisible,
  performanceHudEnabled,
  togglePerformanceHud,
} from "../../../frontend/overlays/performance/performanceHud.ts";

const HUD_ACTION_ID = "developer.performanceHud";
const ROOT = resolve(import.meta.dirname, "../../../..");

/** Run `body` with the monitor switch and the reveal flag restored afterwards. */
function withRestoredDeveloperState(body) {
  const previousReveal = developerReveal.get();
  const previousEnabled = performanceHudEnabled.get();
  try {
    body({ previousEnabled });
  } finally {
    performanceHudEnabled.set(previousEnabled);
    developerReveal.set(previousReveal);
  }
}

test("the development server does not open the developer section by itself", () => {
  // A build-mode flag must never grant developer mode: no host opens the section
  // on its own, so the browser loop starts closed exactly like a release build.
  assert.equal(developerMode.get(), false, "no build mode may grant developer mode");
  const source = readFileSync(resolve(ROOT, "src/core/platform/desktop/developer.ts"), "utf8");
  assert.doesNotMatch(
    source,
    /import\.meta\.env/u,
    "developer mode must not read the build mode; only the host policy may open it",
  );
});

test("F3 and the monitor switch stay shut until the developer section opens", () => {
  const dispose = registerDeveloperActions();
  try {
    withRestoredDeveloperState(({ previousEnabled }) => {
      developerReveal.set(false);
      const hidden = toolbar.node(HUD_ACTION_ID);
      assert.ok(hidden, "the performance monitor action must stay registered");
      assert.equal(actionAvailable(hidden), false, "F3 must not dispatch in a release host");
      assert.equal(runAction(hidden), false, "the action must refuse to run");
      assert.equal(
        togglePerformanceHud(),
        previousEnabled,
        "the switch itself must refuse to move",
      );
      assert.equal(performanceHudEnabled.get(), previousEnabled, "the preference must not move");
      assert.equal(isPerformanceHudVisible(), false, "the monitor must stay hidden");
    });
  } finally {
    dispose();
  }
});

test("opening the developer section lets F3 and the monitor through", () => {
  const dispose = registerDeveloperActions();
  try {
    withRestoredDeveloperState(() => {
      developerReveal.set(true);
      performanceHudEnabled.set(false);
      const revealed = toolbar.node(HUD_ACTION_ID);
      assert.ok(revealed, "the performance monitor action must stay registered");
      assert.equal(actionAvailable(revealed), true, "F3 must dispatch once the section is open");
      assert.equal(isPerformanceHudVisible(), false, "the monitor starts switched off");
      assert.equal(runAction(revealed), true, "the action must run");
      assert.equal(performanceHudEnabled.get(), true, "the preference flips once");
      assert.equal(isPerformanceHudVisible(), true, "the monitor renders once it is switched on");

      assert.equal(togglePerformanceHud(), false, "the switch flips back");
      assert.equal(isPerformanceHudVisible(), false, "switching it off hides the monitor");
    });
  } finally {
    dispose();
  }
});
