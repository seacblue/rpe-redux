/**
 * Core P0 document journeys: open, create, save, and replace policy.
 *
 * These are the shallow checks a smoke run needs before the deeper feature
 * suites are trusted. Feature-specific journeys live outside this file and are
 * intentionally not part of the default smoke scenario.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalChart, chartSemantics, ensureFixtures } from "./fixtures.mjs";
import {
  assertAudioTransport,
  assertCanonical,
  assertHomeScreen,
  closeDocument,
  createCanonical,
  expression,
  readStateExpression,
} from "./journeySupport.mjs";
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const ROUNDTRIP = join(ROOT, ".scratch", "e2e-smoke-quality", "artifacts", "roundtrip.json");
const RESOURCE_ROUNDTRIP = join(
  ROOT,
  ".scratch",
  "e2e-smoke-quality",
  "artifacts",
  "resource-roundtrip.pez",
);

export async function coldOpen(runner) {
  await createCanonical(runner, "e2e-cold-open.json");
  const state = await runner.callApi(readStateExpression());
  runner.assert(state.document.status === "open", "cold-open did not reach open state");
  assertCanonical(runner, state, "cold-open");
  await closeDocument(runner);
  await assertHomeScreen(runner);
}

export async function openResourceChart(runner) {
  const paths = ensureFixtures();
  const opened = await runner.callApi(
    `window.redux.document.openPath(${expression(paths.pez)}, { replace: "discard" })`,
  );
  runner.assert(opened.ok === true, `PEZ open failed: ${JSON.stringify(opened)}`);
  const state = await runner.callApi(readStateExpression());
  runner.assert(
    state.document.format === "pez",
    `PEZ open did not report the PEZ format: ${JSON.stringify(state.document)}`,
  );
  assertCanonical(runner, state, "PEZ open");
  const resourceNames = state.resources.map((entry) => entry.name).sort();
  runner.assert(
    resourceNames.length > 0,
    `PEZ resource references are empty: ${JSON.stringify(resourceNames)}`,
  );
  const playback = await runner.callApi("window.redux.playback.inspect(1)");
  runner.assert(
    playback.ok === true && Array.isArray(playback.value.lines) && playback.value.lines.length > 0,
    "playback has no lines",
  );
  await assertAudioTransport(runner);
  const beforeSave = await runner.callApi("window.redux.library.list({ limit: 100 })");
  const internal = await runner.callApi("window.redux.document.save()");
  runner.assert(
    internal.ok === true && internal.value.state.dirty === false,
    `PEZ library save failed: ${JSON.stringify(internal)}`,
  );
  const afterSave = await runner.callApi("window.redux.library.list({ limit: 100 })");
  const created = afterSave.value.projects.find(
    (project) => !beforeSave.value.projects.some((entry) => entry.id === project.id),
  );
  runner.assert(Boolean(created), "PEZ library save did not create a project");
  const stored = await runner.callApi(`window.redux.library.assets(${expression(created.id)})`);
  const storedNames = stored.value.assets.map((asset) => asset.name);
  runner.assert(
    storedNames.length > 0,
    `PEZ library save lost resources: ${JSON.stringify(storedNames)}`,
  );
  const saved = await runner.callApi(
    `window.redux.document.save(${expression({ path: RESOURCE_ROUNDTRIP })})`,
  );
  runner.assert(saved.ok === true, `PEZ roundtrip save failed: ${JSON.stringify(saved)}`);
  runner.assert(existsSync(RESOURCE_ROUNDTRIP), "PEZ roundtrip file was not written");
  await runner.screenshot("export-toast-media");
  // Regression: the metadata pane is mounted before the open replaces the
  // placeholder session, so it must follow the replacement and show this chart.
  await runner.evaluate(
    "document.querySelector('.sidebar [data-pane=\"metadata\"]')?.click(); true",
  );
  await runner.waitFor("metadata inspector pane", () =>
    runner.evaluate(
      `Boolean(document.querySelector('#inspector [data-panel="metadata"]:not([hidden]) input[name="name"]'))`,
    ),
  );
  const fields = ["name", "composer", "charter", "illustration", "level"];
  const metadata = await runner.evaluate(`(() => {
    const value = (result) => {
      if (!result?.ok) throw new Error(JSON.stringify(result));
      return result.value;
    };
    const meta = value(window.redux.chart.metadata());
    const panel = document.querySelector('#inspector [data-panel="metadata"]:not([hidden])');
    const shown = {};
    for (const key of ${expression(fields)}) {
      const input = panel?.querySelector('input[name="' + key + '"]');
      shown[key] = input ? input.value : null;
    }
    return { meta, shown };
  })()`);
  for (const key of fields) {
    const expected = String(metadata.meta?.[key] ?? "");
    runner.assert(
      metadata.shown[key] === expected,
      `metadata inspector ${key} shows ${JSON.stringify(metadata.shown[key])}, chart has ${JSON.stringify(expected)}`,
    );
  }
  await closeDocument(runner);
}

export async function openExternalPackage(runner) {
  const paths = ensureFixtures();
  const opened = await runner.callApi(
    `window.redux.document.openPath(${expression(paths.pePackage)}, { replace: "discard" })`,
  );
  runner.assert(opened.ok === true, `PE package open failed: ${JSON.stringify(opened)}`);
  await runner.waitFor("converted package loading modal close", () =>
    runner.evaluate(
      "!document.querySelector('dialog.redux-chart-loading[open]') && !document.querySelector('.redux-modal-scrim')",
    ),
  );
  const state = await runner.callApi(readStateExpression());
  runner.assert(state.document.status === "open", "the converted PE package did not open");
  runner.assert(
    state.metadata.name === "PE Package Fixture",
    `the info.csv name was not applied: ${JSON.stringify(state.metadata)}`,
  );
  runner.assert(state.metadata.level === "2", "the info.csv level was not applied");
  runner.assert(state.metadata.song === "smoke.wav", "the package music was not paired");
  runner.assert(state.metadata.background === "smoke.png", "the package cover was not paired");
  const semantics = chartSemantics(state.chart);
  runner.assert(semantics.lines === 1, `the PEC chart lost its judge line: ${semantics.lines}`);
  runner.assert(semantics.notes === 4, `the PEC chart lost notes: ${semantics.notes}`);
  runner.assert(semantics.bpmEntries === 1, "the PEC tempo list was not converted");
  const projects = await runner.callApi(
    'window.redux.library.list({ search: "PE Package Fixture", limit: 20 })',
  );
  runner.assert(
    projects.value.projects.some((project) => project.name === "PE Package Fixture"),
    `the converted package was not imported into the library: ${JSON.stringify(projects)}`,
  );
  await closeDocument(runner);
}

export async function createChart(runner) {
  const { chart } = canonicalChart();
  chart.META.name = "Created Fixture";
  chart.META.composer = "Created Composer";
  chart.META.charter = "Created Charter";
  chart.META.level = "Created Level";
  const invalid = await runner.callApi(`(async () => {
    try {
      return await window.redux.document.create({
        name: "invalid.json",
        chart: { META: null },
        replace: "discard",
      });
    } catch (error) {
      return { threw: true, message: String(error?.message ?? error) };
    }
  })()`);
  runner.assert(
    invalid.threw === true || invalid.ok === false,
    "invalid chart creation was not rejected",
  );
  const created = await runner.callApi(
    `window.redux.document.create(${expression({
      name: "e2e-created.json",
      chart,
      replace: "discard",
    })})`,
  );
  runner.assert(created.ok === true, `valid chart creation failed: ${JSON.stringify(created)}`);
  const state = await runner.callApi(readStateExpression());
  runner.assert(state.metadata.name === "Created Fixture", "created metadata name was lost");
  runner.assert(state.metadata.composer === "Created Composer", "created composer was lost");
  runner.assert(state.metadata.charter === "Created Charter", "created charter was lost");
  runner.assert(state.metadata.level === "Created Level", "created difficulty was lost");
  assertCanonical(runner, state, "create");
  await runner.waitFor("window title saved document", () =>
    runner.evaluate(
      "document.title.startsWith('Created Fixture') && !document.title.includes('*')",
    ),
  );
  await runner.waitFor("status bar chart readouts", () =>
    runner.evaluate(
      "Boolean(document.querySelector('.shell-body > footer #chart-info')?.textContent?.trim())",
    ),
  );
  const savedIdentity = await runner.evaluate(`(() => {
    const footer = document.querySelector('.shell-body > footer');
    const info = footer?.querySelector('#chart-info');
    const footerBox = footer?.getBoundingClientRect();
    const infoBox = info?.getBoundingClientRect();
    return {
      title: document.title,
      documentStatus: Boolean(footer?.querySelector('.document-status')),
      chartInfo: Boolean(info) && (info.textContent ?? '').trim().length > 0,
      chartInfoLeading:
        Boolean(footerBox && infoBox) &&
        infoBox.left - footerBox.left < 64 &&
        infoBox.right <= footerBox.right + 1,
    };
  })()`);
  runner.assert(
    savedIdentity.title.startsWith("Created Fixture") &&
      !savedIdentity.title.includes("*") &&
      savedIdentity.documentStatus === false &&
      savedIdentity.chartInfo === true &&
      savedIdentity.chartInfoLeading === true,
    `the window title and status readouts must follow the saved document: ${JSON.stringify(savedIdentity)}`,
  );
  const edit = await runner.callApi(
    `window.redux.transaction.apply(${expression({
      label: "e2e unsaved indicator",
      metadata: { level: "Unsaved Fixture" },
    })})`,
  );
  runner.assert(
    edit.ok === true && edit.value.status === "committed",
    `unsaved indicator edit failed: ${JSON.stringify(edit)}`,
  );
  await runner.waitFor("window title unsaved indicator", () =>
    runner.evaluate("document.title.includes('*')"),
  );
  const unsavedIdentity = await runner.evaluate(`(() => ({
    title: document.title,
    documentStatus: Boolean(document.querySelector('.shell-body > footer .document-status')),
  }))()`);
  runner.assert(
    unsavedIdentity.title.includes("*") && unsavedIdentity.documentStatus === false,
    `the window title must report unsaved changes: ${JSON.stringify(unsavedIdentity)}`,
  );
  const internal = await runner.callApi("window.redux.document.save()");
  runner.assert(internal.ok === true, `internal save failed: ${JSON.stringify(internal)}`);
  runner.assert(internal.value.state.dirty === false, "internal save left the document dirty");
  await runner.waitFor("window title saved indicator", () =>
    runner.evaluate("!document.title.includes('*')"),
  );
  const projects = await runner.callApi(
    'window.redux.library.list({ search: "Created Fixture", limit: 20 })',
  );
  runner.assert(
    projects.value.projects.some((project) => project.name === "Created Fixture"),
    `internal save did not catalogue the chart: ${JSON.stringify(projects)}`,
  );
  await closeDocument(runner);
}

export async function roundtrip(runner) {
  const { chart, ids } = canonicalChart();
  chart.META.song = "";
  chart.META.background = "";
  chart.META.illustration = "";
  const created = await runner.callApi(
    `window.redux.document.create(${expression({
      name: "e2e-roundtrip.json",
      chart,
      replace: "discard",
    })})`,
  );
  runner.assert(created.ok === true, `roundtrip create failed: ${JSON.stringify(created)}`);
  const transaction = await runner.callApi(
    `window.redux.transaction.apply(${expression({
      label: "e2e roundtrip edit",
      metadata: { name: "Roundtrip Fixture" },
      lines: { update: [{ id: ids.line, patch: { Name: "Roundtrip Line" } }] },
    })})`,
  );
  runner.assert(
    transaction.ok === true && transaction.value.status === "committed",
    "roundtrip edit did not commit",
  );
  const saved = await runner.callApi(
    `window.redux.document.save(${expression({ path: ROUNDTRIP })})`,
  );
  runner.assert(saved.ok === true, `roundtrip save failed: ${JSON.stringify(saved)}`);
  runner.assert(
    typeof saved.value.state.fingerprint === "string" && saved.value.state.fingerprint.length > 0,
    "roundtrip save did not report a fingerprint",
  );
  const reopened = await runner.callApi(
    `window.redux.document.openPath(${expression(ROUNDTRIP)}, { replace: "discard" })`,
  );
  runner.assert(reopened.ok === true, `roundtrip reopen failed: ${JSON.stringify(reopened)}`);
  const afterPath = await runner.callApi(readStateExpression());
  assertCanonical(runner, afterPath, "roundtrip");
  runner.assert(afterPath.metadata.name === "Roundtrip Fixture", "roundtrip lost metadata");
  runner.assert(
    afterPath.lines.find((line) => line.id === ids.line)?.Name === "Roundtrip Line",
    "roundtrip lost line edit",
  );
  const bytes = Buffer.from(readFileSync(ROUNDTRIP)).toString("base64");
  const reopenedBytes = await runner.callApi(`(async () => {
    const binary = atob(${expression(bytes)});
    const source = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return await window.redux.document.openBytes(source, { name: "e2e-roundtrip-reload.json", replace: "discard" });
  })()`);
  runner.assert(
    reopenedBytes.ok === true,
    `roundtrip openBytes failed: ${JSON.stringify(reopenedBytes)}`,
  );
  const afterBytes = await runner.callApi(readStateExpression());
  assertCanonical(runner, afterBytes, "roundtrip bytes");
  runner.assert(afterBytes.metadata.name === "Roundtrip Fixture", "openBytes lost metadata");
  runner.assert(
    afterBytes.lines.find((line) => line.id === ids.line)?.Name === "Roundtrip Line",
    "openBytes lost line edit",
  );
  await closeDocument(runner);
}
