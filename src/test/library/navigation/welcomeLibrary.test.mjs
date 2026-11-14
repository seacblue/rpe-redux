/** Home library ordering, the published card snapshot, and sort defaults. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HomeProjectCardsAdapter,
  getHomeProjectCardsSnapshot,
} from "../../../frontend/screens/welcome/homeProjectCards.ts";
import {
  defaultLibraryDirection,
  getLibrarySort,
} from "../../../frontend/screens/welcome/librarySort.ts";
import {
  buildLibraryEntries,
  matchesLibraryGroups,
} from "../../../frontend/screens/welcome/library/libraryEntries.ts";

function project(id, name, group = "") {
  return {
    id,
    name,
    group,
    archived: false,
    charter: "",
    composer: "",
    level: "",
    noteCount: 0,
    revision: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    size: 0,
  };
}

function actions(overrides = {}) {
  const noop = () => {};
  return {
    onOpenProject: noop,
    onExportProject: noop,
    onRename: noop,
    onCopy: noop,
    onArchive: noop,
    onDelete: noop,
    onSort: noop,
    ...overrides,
  };
}

test("every library project becomes a card in the published order", () => {
  const entries = buildLibraryEntries({
    libraryProjects: [project("b", "Second"), project("a", "First")],
    ...actions(),
  });
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ["project:b", "project:a"],
  );
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["Second", "First"],
  );
});

test("the home card adapter publishes every loaded project", () => {
  const adapter = new HomeProjectCardsAdapter(actions());
  try {
    adapter.updateProjects([project("b", "Second"), project("a", "First")]);
    const published = getHomeProjectCardsSnapshot()?.libraryProjects ?? [];
    assert.deepEqual(
      published.map((entry) => entry.id),
      ["b", "a"],
    );
  } finally {
    adapter.dispose();
  }
});

test("welcome entries prefer the generated thumbnail over the full-size cover", () => {
  const [entry] = buildLibraryEntries({
    libraryProjects: [
      {
        ...project("thumb", "Thumbnail chart"),
        thumbnailUrl: "http://redux.localhost/thumbnail.png",
        coverUrl: "http://redux.localhost/original.png",
      },
    ],
    ...actions(),
  });
  assert.equal(entry.cover, "http://redux.localhost/thumbnail.png");
});

test("group filtering keeps all groups by default and matches stored values", () => {
  const [rpe, phi] = buildLibraryEntries({
    libraryProjects: [project("rpe", "RPE chart", "RPE"), project("phi", "Phi chart", "PhiEdit")],
    ...actions(),
  });
  assert.equal(matchesLibraryGroups(rpe, new Set()), true);
  assert.equal(matchesLibraryGroups(rpe, new Set(["RPE"])), true);
  assert.equal(matchesLibraryGroups(phi, new Set(["RPE"])), false);
});

test("timestamps sort newest first and text sorts ascending by default", () => {
  assert.equal(defaultLibraryDirection("created"), "desc");
  assert.equal(defaultLibraryDirection("updated"), "desc");
  assert.equal(defaultLibraryDirection("name"), "asc");
  assert.equal(defaultLibraryDirection("composer"), "asc");
  assert.equal(defaultLibraryDirection("charter"), "asc");
  assert.deepEqual(getLibrarySort(), { field: "updated", direction: "desc" });
});
