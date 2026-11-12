/** Route policy for paths classified by the backend drop intake. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { dropRoute } from "../../core/global/document/dropIntake.ts";

const PE_ROOT = fileURLToPath(new URL("../fixtures/pe", import.meta.url));

test("an RPE chart keeps its folder and chart entry", () => {
  const route = dropRoute({
    path: "D:/charts/123",
    kind: "chart",
    format: "rpe",
    entry: "D:/charts/123/123.json",
    valid: true,
  });
  assert.deepEqual(route, {
    action: "chart-rpe",
    path: "D:/charts/123",
    entry: "D:/charts/123/123.json",
  });
});

test("an RPE installation opens the review before any importer runs", () => {
  assert.deepEqual(
    dropRoute({
      path: "D:/games/rpe",
      kind: "chart",
      format: "rpe",
      entry: "D:/games/rpe",
      rpeInstallation: true,
      valid: true,
    }),
    { action: "rpe-installation", path: "D:/games/rpe" },
  );
});

test("a PhiEditer installation opens its own review", () => {
  const route = dropRoute({
    path: PE_ROOT,
    kind: "chart",
    format: "pec",
    entry: PE_ROOT,
    peInstallation: true,
    peDetails: {
      root: PE_ROOT,
      installation: true,
      settingsText: readFileSync(new URL("../fixtures/pe/Settings.txt", import.meta.url), "utf8"),
      charts: [],
      warnings: [],
    },
    valid: true,
  });
  assert.deepEqual(route, {
    action: "pe-installation",
    path: PE_ROOT,
  });
});

test("official and PEC charts route to the external importer", () => {
  assert.deepEqual(
    dropRoute({
      path: "D:/charts",
      kind: "chart",
      format: "official",
      entry: "D:/charts/chart.json",
      valid: true,
    }),
    { action: "chart-external", path: "D:/charts/chart.json", format: "official" },
  );
  assert.deepEqual(
    dropRoute({
      path: "D:/charts/chart.pec",
      kind: "chart",
      format: "pec",
      entry: "D:/charts/chart.pec",
      valid: true,
    }),
    { action: "chart-external", path: "D:/charts/chart.pec", format: "pec" },
  );
});

test("packages keep their item for the owning settings surface", () => {
  const extension = {
    path: "D:/packages/demo",
    kind: "extension",
    valid: true,
    packageId: "demo.package",
  };
  assert.deepEqual(dropRoute(extension), { action: "extension", item: extension });
  const skin = { path: "D:/packages/skin", kind: "skin", valid: true, name: "Skin" };
  assert.deepEqual(dropRoute(skin), { action: "skin", item: skin });
});

test("unknown and incomplete shapes stay unsupported", () => {
  const unknown = { path: "D:/notes.txt", kind: "unknown", valid: false };
  assert.deepEqual(dropRoute(unknown), { action: "unsupported", item: unknown });
  const noFormat = { path: "D:/chart.json", kind: "chart", valid: true };
  assert.deepEqual(dropRoute(noFormat), { action: "unsupported", item: noFormat });
});
