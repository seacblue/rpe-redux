/**
 * Experience journeys: the packaged app driven the way a person uses it.
 *
 * The contract journeys in `journeys.mjs` call the public API; these journeys
 * press real keys, move a real pointer over the canvases, click the toolbar and
 * the settings window, and then read the resulting document, selection, and DOM
 * state. They cover the interaction seam between the window, the editor engine,
 * and the surfaces a user actually touches, which unit tests cannot reach.
 *
 * Every journey starts on the home screen (`startsAtHome`) and creates its own
 * chart, so a failed step leaves no shared fixture state behind.
 */

/** Keyboard descriptors for the editor's real shortcut path. */
const KEYS = {
  newDocument: { key: "n", code: "KeyN", keyCode: 78, modifiers: 2 },
  undo: { key: "z", code: "KeyZ", keyCode: 90, modifiers: 2 },
  tap: { key: "q", code: "KeyQ", keyCode: 81 },
  hold: { key: "r", code: "KeyR", keyCode: 82 },
  event: { key: "r", code: "KeyR", keyCode: 82 },
  arrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
};

/** Resolve a page expression to its rounded viewport rectangle, or null. */
async function boundsOfExpression(runner, expression) {
  return runner.evaluate(`(() => {
    const node = ${expression};
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      centerX: Math.round(rect.x + rect.width / 2),
      centerY: Math.round(rect.y + rect.height / 2),
    };
  })()`);
}

/** Resolve a CSS selector to its rounded viewport rectangle, or null. */
async function boundsOf(runner, selector) {
  return boundsOfExpression(runner, `document.querySelector(${JSON.stringify(selector)})`);
}

/** Send one browser-protocol key press through the real keyboard dispatcher. */
async function pressKey(runner, descriptor) {
  const event = {
    key: descriptor.key,
    code: descriptor.code,
    windowsVirtualKeyCode: descriptor.keyCode,
    nativeVirtualKeyCode: descriptor.keyCode,
    modifiers: descriptor.modifiers ?? 0,
  };
  await runner.command("Input.dispatchKeyEvent", { type: "keyDown", ...event });
  await runner.command("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/** Move the pointer without pressing, so the canvas hover state follows it. */
async function hover(runner, point) {
  await runner.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
  });
}

/** Click one viewport point with a plain primary-button press and release. */
async function clickPoint(runner, point) {
  await hover(runner, point);
  await runner.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await runner.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

/** Click an element, retrying until the follow-up check passes. */
async function clickExpression(runner, expression, check, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const bounds = await boundsOfExpression(runner, expression);
    if (bounds) {
      await clickPoint(runner, { x: bounds.centerX, y: bounds.centerY });
      // Dialogs run an opening or exit transform, so the effect of the click is
      // not observable on the next protocol call.
      await settle(300);
      if (!check || (await runner.evaluate(check))) {
        return bounds;
      }
    }
    await settle(350);
  }
  return null;
}

/** Click a selector's center, retrying until the follow-up check passes. */
async function clickSelector(runner, selector, check, attempts = 3) {
  return clickExpression(
    runner,
    `document.querySelector(${JSON.stringify(selector)})`,
    check,
    attempts,
  );
}

/** Document, chart, and selection snapshot used by the experience assertions. */
async function readState(runner) {
  return runner.evaluate(`(() => {
    const doc = window.redux.document.state();
    const notes = window.redux.chart.notes();
    const events = window.redux.chart.events();
    const selection = window.redux.selection.state();
    return {
      document: { status: doc.status, name: doc.name, dirty: doc.dirty },
      notes: notes.ok ? notes.value : null,
      events: events.ok ? events.value.length : null,
      selection: selection.ok ? selection.value : null,
      title: document.title,
    };
  })()`);
}

/** Convert the chart's [whole, numerator, denominator] beat tuple to a number. */
function beatValue(tuple) {
  if (!Array.isArray(tuple) || tuple.length < 3) {
    return Number.NaN;
  }
  return tuple[0] + tuple[1] / tuple[2];
}

/** Wait for a settled UI step the journey cannot observe directly. */
function settle(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

/**
 * Ctrl+N into a blank chart and wait until the editor is ready for pointer input.
 *
 * Falls back to the home screen's New button when the shortcut is swallowed by a
 * still-closing startup surface, so the journey reports the editor state instead
 * of a stray timing failure.
 */
async function createBlankChart(runner) {
  await runner.waitFor(
    "home screen",
    () =>
      runner.evaluate(
        "document.querySelector('.redux-app-shell')?.dataset.atHome === 'true' && document.querySelector('#home')?.hidden === false",
      ),
    Date.now() + 15000,
  );
  await pressKey(runner, KEYS.newDocument);
  const opened = await runner
    .waitFor(
      "blank chart open",
      () => runner.evaluate("window.redux.document.state().status === 'open'"),
      Date.now() + 6000,
    )
    .then(() => true)
    .catch(() => false);
  if (!opened) {
    await clickSelector(
      runner,
      '.redux-library-action[data-onboarding="new"]',
      "window.redux.document.state().status === 'open'",
    );
  }
  await runner.waitFor(
    "blank chart ready",
    () =>
      runner.evaluate(`(() => {
        const state = window.redux.document.state();
        return (
          state.status === 'open' &&
          !document.querySelector('dialog.redux-chart-loading[open]') &&
          !document.querySelector('.redux-modal-scrim') &&
          Boolean(document.querySelector('#notes'))
        );
      })()`),
    Date.now() + 15000,
  );
}

/** Focus the notes canvas so the following shortcut reaches the timeline. */
async function focusNotesCanvas(runner, canvas) {
  await clickPoint(runner, {
    x: canvas.centerX,
    y: canvas.y + Math.round(canvas.height * 0.2),
  });
  await settle(200);
}

/** Place one note at a canvas-relative height fraction of the visible timeline. */
async function placeNote(runner, canvas, fraction, descriptor) {
  const point = {
    x: canvas.centerX,
    y: canvas.y + Math.round(canvas.height * fraction),
  };
  await hover(runner, point);
  await settle(250);
  await pressKey(runner, descriptor);
  await settle(300);
  return point;
}

/** Assert that one paned document is open and clean. */
function assertFreshChart(runner, state, source) {
  runner.assert(state.document.status === "open", `${source} did not open a blank chart`);
  runner.assert(state.notes?.length === 0, "a blank chart should start without notes");
  runner.assert(state.document.dirty === false, "a new blank chart must start clean");
  runner.assert(
    !state.title.includes("*"),
    `a clean chart must not show the unsaved marker: ${state.title}`,
  );
}

/**
 * First-chart journey: create, place notes, nudge, undo, delete, hold, toggle a
 * region, and run playback entirely through window input.
 */
export async function experienceFirstChart(runner) {
  await createBlankChart(runner);
  const opened = await readState(runner);
  assertFreshChart(runner, opened, "Ctrl+N");
  await runner.screenshot("experience-first-chart-home");

  const notesCanvas = await boundsOf(runner, "#notes");
  runner.assert(Boolean(notesCanvas), "the notes timeline canvas is missing");
  await focusNotesCanvas(runner, notesCanvas);

  const placed = await placeNote(runner, notesCanvas, 0.35, KEYS.tap);
  await runner.waitFor(
    "tap placement",
    async () => (await readState(runner)).notes?.length === 1,
    Date.now() + 5000,
  );
  const afterTap = await readState(runner);
  runner.assert(
    afterTap.notes[0]?.note?.type === 1,
    `Q should place a tap note: ${JSON.stringify(afterTap.notes[0])}`,
  );
  runner.assert(afterTap.selection?.notes?.length === 1, "placing a note should select it");
  runner.assert(
    (await runner.evaluate(
      "Boolean(document.querySelector('#inspector [data-panel=\"notes\"]:not([hidden])'))",
    )) === true,
    "the note inspector panel did not replace the empty inspector",
  );
  await runner.waitFor("unsaved marker after placement", () =>
    runner.evaluate("document.title.includes('*') && window.redux.document.state().dirty === true"),
  );

  const tapBeat = beatValue(afterTap.notes[0].note.startTime);
  await pressKey(runner, KEYS.arrowUp);
  await runner.waitFor(
    "arrow-key nudge",
    async () => beatValue((await readState(runner)).notes[0]?.note.startTime) !== tapBeat,
    Date.now() + 5000,
  );
  const nudgedBeat = beatValue((await readState(runner)).notes[0].note.startTime);
  runner.assert(
    nudgedBeat > tapBeat,
    `ArrowUp should move the selected note forwards: ${tapBeat} -> ${nudgedBeat}`,
  );
  await pressKey(runner, KEYS.undo);
  await runner.waitFor(
    "undo nudge",
    async () => beatValue((await readState(runner)).notes[0]?.note.startTime) === tapBeat,
    Date.now() + 5000,
  );

  // Clicking the drawn note selects it; Delete then empties the chart and returns
  // the document to its saved baseline, so the unsaved marker must disappear.
  await clickPoint(runner, placed);
  await runner.waitFor(
    "note selection",
    async () => (await readState(runner)).selection?.notes?.length === 1,
    Date.now() + 5000,
  );
  await pressKey(runner, KEYS.delete);
  await runner.waitFor(
    "note delete",
    async () => (await readState(runner)).notes?.length === 0,
    Date.now() + 5000,
  );
  const afterDelete = await readState(runner);
  runner.assert(
    afterDelete.document.dirty === false,
    "deleting the only edit should return the chart to its clean baseline",
  );
  runner.assert(
    !afterDelete.title.includes("*"),
    `the unsaved marker should clear after undo-to-baseline: ${afterDelete.title}`,
  );
  await pressKey(runner, KEYS.undo);
  await runner.waitFor(
    "undo delete",
    async () => (await readState(runner)).notes?.length === 1,
    Date.now() + 5000,
  );

  // Two R presses place a hold: the first sets the head, the second the tail.
  const holdStart = {
    x: notesCanvas.centerX,
    y: notesCanvas.y + Math.round(notesCanvas.height * 0.3),
  };
  await hover(runner, holdStart);
  await settle(250);
  await pressKey(runner, KEYS.hold);
  await hover(runner, {
    x: holdStart.x,
    y: notesCanvas.y + Math.round(notesCanvas.height * 0.55),
  });
  await settle(250);
  await pressKey(runner, KEYS.hold);
  await runner.waitFor(
    "hold placement",
    async () => (await readState(runner)).notes?.length === 2,
    Date.now() + 5000,
  );
  const hold = (await readState(runner)).notes.find((entry) => entry.note.type === 2);
  runner.assert(Boolean(hold), "two R presses should place a hold note");
  runner.assert(
    beatValue(hold.note.endTime) > beatValue(hold.note.startTime),
    `the hold tail must follow its head: ${JSON.stringify(hold.note)}`,
  );

  // The toolbar region buttons are the real layout control.
  await clickSelector(
    runner,
    "#stage-notes",
    "document.querySelector('.editor')?.className.includes('notes-hidden') === true",
  );
  const hidden = await runner.evaluate("document.querySelector('.editor')?.className ?? ''");
  runner.assert(hidden.includes("notes-hidden"), "the notes region toggle did not hide the field");
  await clickSelector(
    runner,
    "#stage-notes",
    "document.querySelector('.editor')?.className.includes('notes-hidden') === false",
  );
  runner.assert(
    (await runner.evaluate("document.querySelector('.editor')?.className ?? ''")).includes(
      "notes-hidden",
    ) === false,
    "the notes region toggle did not restore the field",
  );

  // Playback through the shared transport button: playing advances the clock and
  // a second click pauses it.
  const play = await boundsOf(runner, "#play");
  runner.assert(Boolean(play), "the transport play button is missing");
  await clickPoint(runner, { x: play.centerX, y: play.centerY });
  await runner.waitFor(
    "playback start",
    () =>
      runner.evaluate(
        "window.redux.playback.state().ok && window.redux.playback.state().value.playing === true",
      ),
    Date.now() + 5000,
  );
  const playing = await runner.evaluate("window.redux.playback.state().value");
  await runner.waitFor(
    "playback clock advance",
    () =>
      runner.evaluate(
        `window.redux.playback.state().value.chartSeconds > ${playing.chartSeconds + 0.03}`,
      ),
    Date.now() + 5000,
  );
  await clickPoint(runner, { x: play.centerX, y: play.centerY });
  await runner.waitFor(
    "playback pause",
    () =>
      runner.evaluate(
        "window.redux.playback.state().ok && window.redux.playback.state().value.playing === false",
      ),
    Date.now() + 5000,
  );
  await runner.screenshot("experience-first-chart-edited");
}

/**
 * Event-field journey: place an event through the keyboard path on the event
 * canvas, verify the double-press commit, and undo it.
 */
export async function experienceEventField(runner) {
  await createBlankChart(runner);
  const before = await readState(runner);
  runner.assert(Number.isInteger(before.events), "the chart did not report its events");
  assertFreshChart(runner, before, "Ctrl+N");
  const eventCanvas = await boundsOf(runner, "#events");
  runner.assert(Boolean(eventCanvas), "the event timeline canvas is missing");

  // R over the event field starts one event; the second R commits its range.
  await hover(runner, {
    x: eventCanvas.centerX,
    y: eventCanvas.y + Math.round(eventCanvas.height * 0.4),
  });
  await settle(250);
  await pressKey(runner, KEYS.event);
  await hover(runner, {
    x: eventCanvas.centerX,
    y: eventCanvas.y + Math.round(eventCanvas.height * 0.55),
  });
  await settle(250);
  await pressKey(runner, KEYS.event);
  await runner.waitFor(
    "event placement",
    async () => (await readState(runner)).events === before.events + 1,
    Date.now() + 5000,
  );
  const placed = await readState(runner);
  runner.assert(placed.document.dirty === true, "placing an event should mark the chart unsaved");
  runner.assert(
    placed.selection?.focus === "events",
    `event placement must move focus to the event field: ${JSON.stringify(placed.selection)}`,
  );

  await pressKey(runner, KEYS.undo);
  await runner.waitFor(
    "undo event placement",
    async () => (await readState(runner)).events === before.events,
    Date.now() + 5000,
  );
  const undone = await readState(runner);
  runner.assert(
    undone.document.dirty === false,
    "undoing the only event edit should return the chart to its clean baseline",
  );
  await runner.screenshot("experience-event-field");
}

/**
 * Settings journey: open the window from the home screen, navigate, toggle a
 * real setting checkbox, close and reopen, and confirm the value persisted.
 */
export async function experienceSettingsWindow(runner) {
  const opened = await clickSelector(
    runner,
    ".redux-welcome-settings",
    "Boolean(document.querySelector('dialog.redux-settings[open]'))",
  );
  runner.assert(Boolean(opened), "the home settings button did not open the settings window");
  await runner.waitFor("settings pages ready", () =>
    runner.evaluate(`(() => {
        const sections = [...document.querySelectorAll('dialog.redux-settings[open] [data-settings-section]')];
        return sections.length > 0 && sections.every((section) => section.dataset.settingsReady === 'true');
      })()`),
  );
  const categories = await runner.evaluate(
    "document.querySelectorAll('dialog.redux-settings[open] .redux-settings-nav-item[data-category]').length",
  );
  runner.assert(categories >= 8, `the settings rail lost categories: ${categories}`);

  const filesCategory = `document.querySelector('dialog.redux-settings[open] .redux-settings-nav-item[data-category="files"]')`;
  // Navigate to the file and data page through its rail item.
  await clickExpression(
    runner,
    filesCategory,
    `${filesCategory}?.getAttribute('aria-current') === 'true'`,
  );
  runner.assert(
    (await runner.evaluate(`${filesCategory}?.getAttribute('aria-current')`)) === "true",
    "clicking a settings category did not mark it current",
  );

  // Bring the setting into view and toggle it with a real pointer click.
  await runner.evaluate(`(() => {
    const input = document.querySelector('dialog.redux-settings[open] #session-restore');
    input?.scrollIntoView({ block: 'center' });
    return Boolean(input);
  })()`);
  await settle(400);
  const toggle = await boundsOf(runner, "dialog.redux-settings[open] #session-restore");
  runner.assert(Boolean(toggle), "the session-restore setting is missing from the files page");
  const before = await runner.evaluate(
    "document.querySelector('dialog.redux-settings[open] #session-restore').checked",
  );
  await clickPoint(runner, { x: toggle.centerX, y: toggle.centerY });
  await runner.waitFor("toggle setting", () =>
    runner.evaluate(
      `document.querySelector('dialog.redux-settings[open] #session-restore').checked !== ${before}`,
    ),
  );
  const after = await runner.evaluate(
    "document.querySelector('dialog.redux-settings[open] #session-restore').checked",
  );
  runner.assert(
    (await runner.evaluate("window.redux.values.byId.get('session-restore')")) === after,
    "the settings checkbox and the stored value disagree",
  );

  // Close through the heading's close button; the dialog must leave the top layer.
  const closeButton = `document.querySelector('dialog.redux-settings[open] .redux-settings-heading button')`;
  const closed = await clickExpression(
    runner,
    closeButton,
    "!document.querySelector('dialog.redux-settings[open]')",
  );
  runner.assert(Boolean(closed), "the settings heading has no working close button");
  await runner.waitFor("settings closed", () =>
    runner.evaluate("!document.querySelector('dialog.redux-settings[open]')"),
  );

  // Reopening shows the persisted value, then the journey restores the default.
  await clickSelector(
    runner,
    ".redux-welcome-settings",
    "Boolean(document.querySelector('dialog.redux-settings[open]'))",
  );
  await runner.waitFor("settings reopened", () =>
    runner.evaluate("Boolean(document.querySelector('dialog.redux-settings[open]'))"),
  );
  await clickExpression(
    runner,
    filesCategory,
    `${filesCategory}?.getAttribute('aria-current') === 'true'`,
  );
  await runner.waitFor("settings value persisted", () =>
    runner.evaluate(
      `document.querySelector('dialog.redux-settings[open] #session-restore')?.checked === ${after}`,
    ),
  );
  await runner.evaluate(`(() => {
    const input = document.querySelector('dialog.redux-settings[open] #session-restore');
    input?.scrollIntoView({ block: 'center' });
    return Boolean(input);
  })()`);
  await settle(300);
  const restore = await boundsOf(runner, "dialog.redux-settings[open] #session-restore");
  await clickPoint(runner, { x: restore.centerX, y: restore.centerY });
  await runner.waitFor("restore setting", () =>
    runner.evaluate(
      `document.querySelector('dialog.redux-settings[open] #session-restore').checked === ${before}`,
    ),
  );
  await clickExpression(
    runner,
    closeButton,
    "!document.querySelector('dialog.redux-settings[open]')",
  );
  await runner.screenshot("experience-settings-window");
}

/** Experience journeys start on the home screen instead of a startup chart. */
for (const journey of [experienceFirstChart, experienceEventField, experienceSettingsWindow]) {
  journey.startsAtHome = true;
}
