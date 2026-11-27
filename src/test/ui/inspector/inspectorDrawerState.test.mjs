/** Drawer pages and inspector panes cannot stay selected behind each other. */
import assert from "node:assert/strict";
import test from "node:test";
import { createValue } from "../../../core/state/values.ts";
import { readDrawerPane } from "../../../core/shell/drawerPane.ts";
import {
  closeDrawer,
  getDrawerState,
  openDrawerPane,
  registerDrawerPane,
} from "../../../frontend/chrome/drawer/drawerPanes.ts";
import {
  bindInspectorState,
  bindInspectorLifecycle,
  openInspector,
  openPane,
  registerInspectorPanel,
} from "../../../frontend/screens/editor/inspector/controller.ts";

/** Registers one document page under a test id. */
function registerTestDrawer(id) {
  return registerDrawerPane({
    id,
    order: 1,
    label: "test.documentPage",
    icon: "grid",
    body: () => null,
  });
}

/** Registers one inspector pane under a test id. */
function registerTestPane(id, open) {
  return registerInspectorPanel({
    id,
    component: () => null,
    ...(open ? { open } : {}),
  });
}

test("an invalid drawer pane changes neither the drawer nor the core read", () => {
  const drawerId = "test:drawer-invalid";
  const disposeDrawer = registerTestDrawer(drawerId);
  try {
    assert.equal(openDrawerPane(drawerId), true);
    const opened = getDrawerState();
    assert.equal(readDrawerPane(), opened.pane);

    assert.equal(openDrawerPane("test:drawer-missing"), false);
    assert.equal(openDrawerPane("   "), false);
    assert.deepEqual(getDrawerState(), opened);
    assert.equal(readDrawerPane(), opened.pane);
  } finally {
    closeDrawer();
    disposeDrawer();
  }
});

test("opening a pane closes an open drawer and activates the pane", () => {
  const drawerId = "test:drawer-open";
  const paneId = "test:pane-from-drawer";
  const activePane = createValue({ initial: "" });
  const disposeDrawer = registerTestDrawer(drawerId);
  const disposePane = registerTestPane(paneId);
  try {
    assert.equal(openDrawerPane(drawerId), true);
    assert.equal(getDrawerState().open, true);

    assert.equal(openPane(paneId, activePane), true);
    assert.equal(getDrawerState().open, false);
    assert.equal(activePane.get(), paneId);
  } finally {
    disposePane();
    disposeDrawer();
  }
});

test("opening a pane leaves a closed drawer closed and keeps its page", () => {
  const drawerId = "test:drawer-closed";
  const paneId = "test:pane-from-closed-drawer";
  const activePane = createValue({ initial: "" });
  const disposeDrawer = registerTestDrawer(drawerId);
  const disposePane = registerTestPane(paneId);
  try {
    assert.equal(openDrawerPane(drawerId), true);
    closeDrawer();
    const closed = getDrawerState();
    assert.equal(closed.open, false);

    assert.equal(openPane(paneId, activePane), true);
    assert.deepEqual(getDrawerState(), closed);
    assert.equal(activePane.get(), paneId);
  } finally {
    disposePane();
    disposeDrawer();
  }
});

test("a pane with its own open entry point still closes the drawer", () => {
  const drawerId = "test:drawer-custom-open";
  const paneId = "test:pane-custom-open";
  let opened = 0;
  const disposeDrawer = registerTestDrawer(drawerId);
  const disposePane = registerTestPane(paneId, () => {
    opened += 1;
  });
  try {
    assert.equal(openDrawerPane(drawerId), true);

    assert.equal(openPane(paneId), true);
    assert.equal(opened, 1);
    assert.equal(getDrawerState().open, false);
  } finally {
    disposePane();
    disposeDrawer();
  }
});

test("direct inspector activation also closes an open drawer", () => {
  const drawerId = "test:drawer-direct";
  const paneId = "test:pane-direct";
  const activePane = createValue({ initial: "" });
  const disposeDrawer = registerTestDrawer(drawerId);
  const disposePane = registerTestPane(paneId);
  try {
    assert.equal(openDrawerPane(drawerId), true);

    assert.equal(openInspector(paneId, activePane), true);
    assert.equal(getDrawerState().open, false);
    assert.equal(activePane.get(), paneId);
  } finally {
    disposePane();
    disposeDrawer();
  }
});

test("a shell pane switch closes the bound inspector synchronously", () => {
  const activePane = createValue({ initial: "test:pane-old" });
  let closed = 0;
  const oldPane = registerInspectorPanel({
    id: "test:pane-old",
    component: () => null,
  });
  const newPane = registerTestPane("test:pane-switch");
  const disposeLifecycle = bindInspectorState(activePane);
  const closeLifecycle = bindInspectorLifecycle("test:pane-old", {
    onClose: () => {
      closed += 1;
    },
  });
  try {
    assert.equal(openPane("test:pane-switch"), true);
    assert.equal(activePane.get(), "test:pane-switch");
    assert.equal(closed, 1);
  } finally {
    closeLifecycle();
    disposeLifecycle();
    newPane();
    oldPane();
  }
});
