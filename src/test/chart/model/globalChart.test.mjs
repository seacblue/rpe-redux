/** The global chart source follows session replacement without stale listeners. */
import assert from "node:assert/strict";
import test from "node:test";
import { createSessionChartSource } from "../../../frontend/screens/global/sessionChartSource.ts";

/** A chart-bearing event target whose live change-listener count is observable. */
class FakeSession extends EventTarget {
  /** Creates a session over one fake chart object. */
  constructor(chart) {
    super();
    this.chart = chart;
    this.contentRevision = 0;
    this.changeListeners = 0;
  }

  /** Registers a change listener and tracks the live count. */
  addEventListener(type, listener, options) {
    if (type === "change") {
      this.changeListeners += 1;
    }
    super.addEventListener(type, listener, options);
  }

  /** Removes a change listener and tracks the live count. */
  removeEventListener(type, listener, options) {
    if (type === "change") {
      this.changeListeners -= 1;
    }
    super.removeEventListener(type, listener, options);
  }

  /** Publishes one chart change like `EditorSession.notify`. */
  change() {
    this.dispatchEvent(new Event("change"));
  }
}

/** A replaceable session holder with observable replacement listeners. */
function fakeSessionHost(initial) {
  const listeners = new Set();
  return {
    current: initial,
    /** Registers one replacement listener. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Installs the next session and notifies every replacement listener. */
    replace(next) {
      this.current = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    /** The number of live replacement listeners. */
    listenerCount() {
      return listeners.size;
    },
  };
}

test("tracks the active session chart and migrates after replacement", () => {
  const first = new FakeSession({ name: "first" });
  const host = fakeSessionHost(first);
  const source = createSessionChartSource(host);
  assert.equal(source.getSnapshot(), first.chart);

  let notifications = 0;
  const unsubscribe = source.subscribe(() => {
    notifications += 1;
  });
  assert.equal(first.changeListeners, 1);
  assert.equal(host.listenerCount(), 1);
  first.change();
  assert.equal(notifications, 1);

  const second = new FakeSession({ name: "second" });
  host.replace(second);
  assert.equal(source.getSnapshot(), second.chart);
  assert.equal(notifications, 2);
  assert.equal(first.changeListeners, 0);
  assert.equal(second.changeListeners, 1);

  // The old session no longer drives the source once the listener moved.
  first.change();
  assert.equal(notifications, 2);
  second.change();
  assert.equal(notifications, 3);

  unsubscribe();
  assert.equal(second.changeListeners, 0);
  assert.equal(host.listenerCount(), 0);
  second.change();
  assert.equal(notifications, 3);
});

test("keeps the committed chart reference stable between commits", () => {
  const chart = { name: "stable" };
  const session = new FakeSession(chart);
  const source = createSessionChartSource(fakeSessionHost(session));
  assert.equal(source.getSnapshot(), chart);
  // Selection-only notifications reuse the same history document.
  session.change();
  assert.equal(source.getSnapshot(), chart);
});

test("shares one binding across subscribers and unbinds after the last", () => {
  const session = new FakeSession({ name: "only" });
  const host = fakeSessionHost(session);
  const source = createSessionChartSource(host);
  const notifications = [];
  const unsubscribeFirst = source.subscribe(() => notifications.push("first"));
  const unsubscribeSecond = source.subscribe(() => notifications.push("second"));
  assert.equal(session.changeListeners, 1);
  assert.equal(host.listenerCount(), 1);

  session.change();
  assert.deepEqual(notifications, ["first", "second"]);

  unsubscribeFirst();
  assert.equal(session.changeListeners, 1);
  assert.equal(host.listenerCount(), 1);
  session.change();
  assert.deepEqual(notifications, ["first", "second", "second"]);

  unsubscribeSecond();
  assert.equal(session.changeListeners, 0);
  assert.equal(host.listenerCount(), 0);
});

test("a missing host reports a null snapshot", () => {
  const source = createSessionChartSource(null);
  assert.equal(source.getSnapshot(), null);
  assert.equal(source.getRevision(), 0);
  const unsubscribe = source.subscribe(() => {
    assert.fail("a null host must not notify");
  });
  unsubscribe();
});

test("the revision changes when a paged facade is edited in place", () => {
  // A paged document keeps one facade object across edits, so consumers that
  // render chart-derived fields (the timing list) must watch the revision.
  const chart = { name: "facade" };
  const session = new FakeSession(chart);
  const source = createSessionChartSource(fakeSessionHost(session));
  assert.equal(source.getRevision(), 0);

  session.contentRevision = 1;
  session.change();
  assert.equal(source.getSnapshot(), chart, "the facade identity is unchanged");
  assert.equal(source.getRevision(), 1, "the revision still reports the edit");
});

test("a replaced session reports the new session revision", () => {
  const first = new FakeSession({ name: "first" });
  first.contentRevision = 7;
  const host = fakeSessionHost(first);
  const source = createSessionChartSource(host);
  assert.equal(source.getRevision(), 7);

  const second = new FakeSession({ name: "second" });
  second.contentRevision = 2;
  host.replace(second);
  assert.equal(source.getRevision(), 2);
});
