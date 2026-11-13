/** Run the P0 smoke scenarios against the mounted desktop app. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFixtures } from "./e2e/fixtures.mjs";
import { journeys } from "./e2e/journeyGroups.mjs";
import { cliOptions, SmokeRunner } from "./e2e/runner.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const REPORT_DIR = join(ROOT, ".scratch", "e2e-smoke-quality", "artifacts");

async function recover(runner) {
  try {
    await runner.evaluate(
      "document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close())",
    );
  } catch {
    // The failed scenario may have already torn down the page.
  }
  try {
    await runner.callApi('window.redux.document.close({ replace: "discard" })');
  } catch {
    // Cleanup is best effort; the runner still reports the original failure.
  }
}

async function main() {
  const { scenario } = cliOptions();
  const fixtures = ensureFixtures();
  const selected =
    scenario === "all"
      ? Object.entries(journeys)
      : scenario in journeys
        ? [[scenario, journeys[scenario]]]
        : [];
  if (!selected.length) {
    throw new Error(
      `Unknown scenario ${scenario}; choose one of ${Object.keys(journeys).join(", ")}`,
    );
  }
  // Experience journeys begin on the home screen and create their own document;
  // the contract journeys keep the shared startup chart. A mixed selection needs
  // one session per journey, which `npm run smoke` provides by spawning each
  // group separately.
  const startAtHome = selected.every(([, journey]) => journey.startsAtHome === true);
  if (!startAtHome && selected.some(([, journey]) => journey.startsAtHome === true)) {
    throw new Error(
      "Experience journeys cannot share a session with contract journeys; " +
        "run one group per process (npm run smoke does this).",
    );
  }

  const runner = new SmokeRunner({
    startupPath: startAtHome ? null : fixtures.json,
    startAtHome,
  });
  try {
    await runner.start();
    for (const [name, journey] of selected) {
      try {
        await runner.scenario(name, () => journey(runner));
      } catch (error) {
        console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
        await recover(runner);
      }
    }
    mkdirSync(REPORT_DIR, { recursive: true });
    const report = {
      generatedAt: new Date().toISOString(),
      runner: "src/test/e2eJourneySmoke.mjs",
      selected: selected.map(([name]) => name),
      checks: runner.checks,
      scenarios: runner.results,
      passed: runner.results.every((result) => result.status === "passed"),
    };
    writeFileSync(join(REPORT_DIR, "journey-report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Journey report: ${join(REPORT_DIR, "journey-report.json")}`);
    console.log(`Assertions: ${runner.checks}`);
    for (const result of runner.results) {
      console.log(
        `  ${result.status.toUpperCase().padEnd(6)} ${result.name} ` +
          `(${result.checks} assertions, ${result.elapsedMs}ms)`,
      );
    }
    if (!report.passed) {
      process.exitCode = 1;
    }
  } finally {
    await runner.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`FAIL e2eJourneySmoke: ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
}
