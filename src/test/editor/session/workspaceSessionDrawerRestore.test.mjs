/** Session restore reopens a saved drawer through the same single write entry as every other drawer activation. */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue, defineValue } from "../../../core/state/values.ts";
import { readDrawerPane } from "../../../core/shell/drawerPane.ts";
import {
  WORKSPACE_SESSION_VERSION,
  writeWorkspaceSession,
} from "../../../core/edit/session/workspaceSession.ts";
import { workspace } from "../../../core/api/workspace.ts";
import {
  closeDrawer,
  getDrawerState,
  registerDrawerPane,
  subscribeDrawer,
} from "../../../frontend/chrome/drawer/drawerPanes.ts";
import { createWorkspaceSessionRuntime } from "../../../frontend/screens/editor/workspace/session/workspaceSessionRuntime.ts";

/** Defines the setting the restore runtime reads before it opens the session. */
defineValue({ id: "session-restore", initial: true });

/** One chart shape sufficient for applying the saved view. */
function createSession() {
  return {
    chart: { META: { offset: 0 }, judgeLineList: [{}] },
    lineIndex: 0,
    multiLineEnabled: false,
    multiLineMode: "notes",
    multiLineMerge: true,
    multiLineIndices: [],
    selectLine(line) {
      this.lineIndex = line;
    },
    setMultiLineSelection(indices) {
      this.multiLineIndices = indices;
    },
    setMultiLineMode(mode) {
      this.multiLineMode = mode;
    },
    setMultiLineMerge(merge) {
      this.multiLineMerge = merge;
    },
  };
}

/** Creates the runtime with one saved path document and a no-op document host. */
function createRuntime() {
  const session = createSession();
  const counters = { invalidated: 0, rendered: 0 };
  const runtime = createWorkspaceSessionRuntime({
    documents: {
      current: { path: "C:/fixtures/smoke.pez" },
      open: async () => ({
        candidate: { name: "smoke.pez", chart: session.chart },
        assets: new Map(),
      }),
    },
    hasDocument: () => true,
    document: { chartName: "smoke.pez", libraryProject: null },
    session: () => session,
    viewport: {
      origin: 0,
      setOrigin(value) {
        this.origin = value;
        return true;
      },
      multiLineScroll: 0,
      setMultiLineZoom() {},
    },
    chartSeconds: () => 1,
    activeInspector: createValue({ initial: "" }),
    getChartInfoExpanded: () => true,
    seek() {},
    loadCandidate: async () => {},
    invalidate: () => {
      counters.invalidated += 1;
    },
    renderSession: () => {
      counters.rendered += 1;
    },
  });
  return { runtime, counters };
}

test("session restore reopens the saved drawer with one write", async () => {
  const disposeDrawer = registerDrawerPane({
    id: "test:restore-lines",
    order: 1,
    label: "test.documentPage",
    icon: "grid",
    body: () => null,
  });
  closeDrawer();
  writeWorkspaceSession({
    version: WORKSPACE_SESSION_VERSION,
    savedAt: Date.now(),
    documentRef: { kind: "path", path: "C:/fixtures/smoke.pez", name: "smoke.pez" },
    view: {
      playheadSeconds: 1,
      originBeat: 0,
      lineIndex: 0,
      multiLine: { enabled: false, mode: "notes", merge: true, indices: [] },
    },
    panels: {
      activeInspector: "",
      chartInfoExpanded: true,
      drawerPane: "test:restore-lines",
      drawerOpen: true,
    },
  });
  let notifications = 0;
  const unsubscribe = subscribeDrawer(() => {
    notifications += 1;
  });
  const { runtime, counters } = createRuntime();
  try {
    await runtime.restore();

    assert.deepEqual(getDrawerState(), { open: true, pane: "test:restore-lines" });
    assert.equal(notifications, 1);
    assert.equal(readDrawerPane(), "test:restore-lines");
    assert.equal(workspace.drawerPane(), "test:restore-lines");
    assert.equal(counters.invalidated, 1);
    assert.equal(counters.rendered, 1);
  } finally {
    unsubscribe();
    runtime.dispose();
    closeDrawer();
    disposeDrawer();
  }
});
