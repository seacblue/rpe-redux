/** Application menu sections keep their command order and unique ids. */
import assert from "node:assert/strict";
import test from "node:test";
import { APPLICATION_MENUS } from "../../../frontend/chrome/topbar/menuSpec.ts";

test("the File menu keeps its document and settings order", () => {
  const file = APPLICATION_MENUS.find((menu) => menu.id === "file");
  assert.ok(file);
  assert.deepEqual(file.actionIds, [
    "file.new",
    "file.open",
    "document.save",
    "document.restoreBackup",
    "file.export",
    "document.close",
    "workspace.settings",
  ]);
});

test("the Help menu exposes the operation list and support links", () => {
  const help = APPLICATION_MENUS.find((menu) => menu.id === "help");
  assert.ok(help);
  assert.deepEqual(help.actionIds, [
    "help.onboarding-guide",
    "help.survey",
    "help.developer-docs",
    "help.changelog",
    "help.about",
  ]);
});

test("developer commands stay out of the application menu", () => {
  assert.equal(
    APPLICATION_MENUS.some((menu) => menu.id === "developer"),
    false,
  );
});

test("every application menu has a unique id and at least one command", () => {
  const ids = new Set();
  for (const menu of APPLICATION_MENUS) {
    assert.equal(ids.has(menu.id), false, menu.id);
    ids.add(menu.id);
    assert.ok(menu.actionIds.length > 0, menu.id);
  }
});
