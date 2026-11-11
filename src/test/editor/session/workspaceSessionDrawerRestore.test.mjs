/** Session restore maps a legacy drawer page to the Inspector page that replaced it. */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue, defineValue } from "../../../core/state/values.ts";
import {
  WORKSPACE_SESSION_VERSION,
  writeWorkspaceSession,
} from "../../../core/edit/session/workspaceSession.ts";
import {
  closeDrawer,
  getDrawerState,
  subscribeDrawer,
} from "../../../frontend/chrome/drawer/drawerPanes.ts";
import { registerInspectorPanel } from "../../../frontend/screens/editor/inspector/controller.ts";
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
function createRuntime(activeInspector = createValue({ initial: "" })) {
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
    activeInspector,
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
  return { runtime, counters, activeInspector };
}

test("session restore opens a legacy document drawer as its Inspector page", async () => {
  const disposePanel = registerInspectorPanel({
    id: "test:restore-lines",
    component: () => null,
    label: "test.documentPage",
    icon: "grid",
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
  let drawerNotifications = 0;
  const unsubscribe = subscribeDrawer(() => {
    drawerNotifications += 1;
  });
  const { runtime, counters, activeInspector } = createRuntime();
  try {
    await runtime.restore();

    assert.equal(activeInspector.get(), "test:restore-lines");
    assert.deepEqual(getDrawerState(), { open: false, pane: "" });
    assert.equal(drawerNotifications, 0);
    assert.equal(counters.invalidated, 1);
    assert.equal(counters.rendered, 1);
  } finally {
    unsubscribe();
    runtime.dispose();
    closeDrawer();
    disposePanel();
  }
});
