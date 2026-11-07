/**
 * The P0 smoke suite: API/Extension contract, documents, settings pages, and
 * session restore.
 *
 * Feature-specific journeys are not part of the default run. Their logic is
 * covered by unit suites, and the smoke run only proves the shared end-to-end
 * paths still connect the packaged app to the public API.
 */
import { coldOpen, createChart, openResourceChart, roundtrip } from "./journeys.mjs";
import { apiContract, replacePolicy } from "./contractJourneys.mjs";
import { settingsSmoke } from "./settingsSmokeJourney.mjs";
import { sessionRestore } from "./sessionRestoreJourney.mjs";

function sequence(steps) {
  return async (runner) => {
    for (const [name, step] of steps) {
      try {
        await step(runner);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${name}: ${message}`, { cause: error });
      }
      await runner.evaluate(
        "document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close()); true",
      );
    }
  };
}

export const journeys = {
  "api-contract": apiContract,
  documents: sequence([
    ["cold-open", coldOpen],
    ["open-resource", openResourceChart],
    ["create", createChart],
    ["roundtrip", roundtrip],
    ["replace-policy", replacePolicy],
  ]),
  settings: settingsSmoke,
  "session-restore": sessionRestore,
};
