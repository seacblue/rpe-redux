/**
 * Contract: opening a chart file from the desktop first creates/updates its
 * library project, refreshes the home cards, and opens that project.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ProjectHome } from "../../frontend/screens/welcome/projectLibrary.ts";
import { getHomeProjectCardsSnapshot } from "../../frontend/screens/welcome/homeProjectCards.ts";

test("importAndOpenFile persists the chart before opening it", async () => {
  const calls = [];
  const home = new ProjectHome({
    importFile: async (path) => {
      calls.push(["import", path]);
      return "project-rbq1030";
    },
    openProject: async (id) => {
      calls.push(["open-project", id]);
      return true;
    },
    exportProject: async () => undefined,
    reportError: () => undefined,
  });
  home.refresh = async () => {
    calls.push(["refresh"]);
  };
  home.open = async (id) => {
    calls.push(["open-imported", id]);
  };

  const opened = await home.importAndOpenFile("E:\\charts\\rbQ1030.pez");

  assert.equal(opened, true);
  assert.deepEqual(calls, [
    ["import", "E:\\charts\\rbQ1030.pez"],
    ["refresh"],
    ["open-imported", "project-rbq1030"],
  ]);
  home.dispose();
});

test("importAndOpenFile leaves unsupported paths to the native fallback", async () => {
  const home = new ProjectHome({
    importFile: async () => null,
    openProject: async () => true,
    exportProject: async () => undefined,
    reportError: () => undefined,
  });

  assert.equal(await home.importAndOpenFile("E:\\charts\\unknown.zip"), false);
  home.dispose();
});

test("a home open request is claimed before async work and ignores a second click", async () => {
  let resolveOpen;
  let openCount = 0;
  const home = new ProjectHome({
    importFile: async () => null,
    openProject: async () => {
      openCount += 1;
      await new Promise((resolve) => {
        resolveOpen = resolve;
      });
      return true;
    },
    exportProject: async () => undefined,
    reportError: () => undefined,
  });
  home.cards.updateProjects([
    {
      id: "project-a",
      name: "A",
      group: "",
      archived: false,
      charter: "",
      composer: "",
      level: "",
      noteCount: 0,
      revision: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      size: 0,
    },
  ]);

  const snapshot = getHomeProjectCardsSnapshot();
  snapshot?.onOpenProject("project-a");
  assert.equal(getHomeProjectCardsSnapshot()?.openingProjectId, "project-a");
  snapshot?.onOpenProject("project-a");
  assert.equal(openCount, 1);

  resolveOpen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getHomeProjectCardsSnapshot()?.openingProjectId, null);
  home.dispose();
});
