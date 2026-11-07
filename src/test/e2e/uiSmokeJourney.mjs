/**
 * P0 workspace journey: the home library, the editor surface, the drawer pages
 * inside the inspector, and every registered inspector pane.
 *
 * This is deliberately structural: it proves that each registry-backed surface
 * mounts from the shared chrome, not that a feature performs a specific edit.
 * Feature behaviour belongs to unit suites and focused regression runs.
 */
import { canonicalChart } from "./fixtures.mjs";
import { assertHomeScreen, closeDocument, delay } from "./journeySupport.mjs";
import {
  clickPointer,
  drawerPaneIds,
  drawerSdkState,
  frameGeometry,
  homeLibraryLayout,
  movePointer,
  near,
  openDrawerPane,
  pressKey,
  railEntryPoint,
  railState,
} from "./surfaceSupport.mjs";

export async function workspaceSurfaces(runner) {
  // The smoke harness starts with a fixture document. Close it first so the home
  // library and the empty-document return path are part of the same journey.
  const startup = await runner.callApi("window.redux.document.state()");
  runner.assert(
    startup.status === "open",
    `smoke startup document is not open: ${JSON.stringify(startup)}`,
  );
  await closeDocument(runner);
  await assertHomeScreen(runner);
  const homeIdentity = await runner.evaluate(`(() => ({
    title: document.title,
    documentLabel: Boolean(document.querySelector('.redux-titlebar-document, [data-document-name]')),
    topbar: Boolean(document.querySelector('.redux-titlebar')),
  }))()`);
  runner.assert(
    homeIdentity.topbar === true &&
      homeIdentity.documentLabel === false &&
      homeIdentity.title.length > 0,
    `the empty window must show the application name without a chart label: ${JSON.stringify(homeIdentity)}`,
  );
  // A title-bar menu trigger opens its popup. Clicking that trigger again keeps
  // the menu open; only a pointer press outside the menu dismisses it.
  const titleMenuTrigger = ".redux-titlebar-menu-button, .redux-titlebar-menubar-trigger";
  const titleMenuPopup = ".redux-app-menu-sheet, .redux-titlebar-menubar-popup";
  await runner.evaluate(`document.querySelector('${titleMenuTrigger}')?.click(); true`);
  await runner.waitFor("title-bar menu open", () =>
    runner.evaluate(`Boolean(document.querySelector('${titleMenuPopup}'))`),
  );
  await runner.evaluate(`document.querySelector('${titleMenuTrigger}')?.click(); true`);
  runner.assert(
    await runner.evaluate(`Boolean(document.querySelector('${titleMenuPopup}'))`),
    "clicking the open title-bar menu trigger must keep the menu open",
  );
  await runner.evaluate(
    "document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true",
  );
  await runner.waitFor("title-bar menu outside close", () =>
    runner.evaluate(`!document.querySelector('${titleMenuPopup}')`),
  );
  const home = await runner.evaluate(`(() => {
    const library = document.querySelector('.redux-welcome-library');
    return {
      library: Boolean(library),
      search: Boolean(library?.querySelector('input[type="search"]')),
      actions: library?.querySelectorAll('.redux-library-action').length ?? 0,
    };
  })()`);
  runner.assert(home.library && home.search, `home library is incomplete: ${JSON.stringify(home)}`);
  runner.assert(home.actions > 0, `home library actions are missing: ${JSON.stringify(home)}`);

  const split = await homeLibraryLayout(runner);
  runner.assert(
    split.layout === "fixed",
    `the home split must publish its fixed-column layout: ${JSON.stringify(split)}`,
  );
  runner.assert(
    split.detail !== null,
    `the home detail column must stay mounted: ${JSON.stringify(split)}`,
  );
  const [left, right] = split.columns.split(/\s+/u).map(Number.parseFloat);
  runner.assert(
    Number.isFinite(left) &&
      Number.isFinite(right) &&
      Math.abs(left - 380) <= 2 &&
      right > left + 200 &&
      split.sideAlign === "start",
    `the home detail column must stay 380px with the library taking the rest: ${JSON.stringify(split)}`,
  );
  const homeButtons = [...split.cardActions, ...split.footerActions];
  runner.assert(
    split.footerActions.length === 2 &&
      split.footerActions.every((button) => button.size) &&
      split.footerActions[0]?.solid === true &&
      split.footerActions[1]?.outlined === true,
    `the home footer actions need one primary and one secondary: ${JSON.stringify(split)}`,
  );
  runner.assert(
    split.cardActions.length === 0 ||
      (split.cardActions.length === 3 &&
        split.cardActions[0]?.outlined === true &&
        split.cardActions[1]?.danger === true &&
        split.cardActions[2]?.solid === true),
    `the detail actions need secondary, danger, and primary roles: ${JSON.stringify(split)}`,
  );
  runner.assert(
    homeButtons.every((button) => button.size) &&
      new Set(homeButtons.map((button) => Math.round(button.height))).size === 1,
    `the home action groups must share one size preset: ${JSON.stringify(split)}`,
  );

  // The overflow menu carries the RPE migration entry, which opens the shared
  // import dialog; the menu trigger sits in the library toolbar.
  await runner.evaluate("document.querySelector('#home .redux-welcome-more')?.click(); true");
  await runner.waitFor("welcome more menu", () =>
    runner.evaluate("Boolean(document.querySelector('.redux-welcome-more-popup button'))"),
  );
  // Let the first-open animation dispatch its event before counting the
  // second activation; slow desktop startup can otherwise attach the probe
  // between popover insertion and the first rendered frame.
  await runner.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
  );
  await runner.evaluate(`(() => {
    const popup = document.querySelector('.redux-welcome-more-popup');
    if (!popup) return false;
    popup.__reduxTestAnimationStarts = 0;
    popup.addEventListener('animationstart', () => {
      popup.__reduxTestAnimationStarts += 1;
    });
    return true;
  })()`);
  await runner.evaluate("document.querySelector('#home .redux-welcome-more')?.click(); true");
  await runner.evaluate(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
  );
  const repeatedOpen = await runner.evaluate(`(() => {
    const popup = document.querySelector('.redux-welcome-more-popup');
    return {
      open: Boolean(popup?.matches(':popover-open')),
      animationStarts: popup?.__reduxTestAnimationStarts ?? -1,
    };
  })()`);
  runner.assert(
    repeatedOpen.open && repeatedOpen.animationStarts === 0,
    `repeated overflow-menu clicks must not replay the enter animation: ${JSON.stringify(repeatedOpen)}`,
  );
  await runner.evaluate(
    "document.querySelector('.redux-welcome-more-popup button')?.click(); true",
  );
  await runner.waitFor("welcome import dialog", () =>
    runner.evaluate("Boolean(document.querySelector('dialog.redux-welcome-import-dialog[open]'))"),
  );
  await runner.evaluate(
    "document.querySelector('dialog.redux-welcome-import-dialog .modal-actions button')?.click(); true",
  );
  await runner.waitFor("welcome import dialog close", () =>
    runner.evaluate("!document.querySelector('dialog.redux-welcome-import-dialog[open]')"),
  );

  // Markers are stored in chart seconds while the scrubber runs on audio time.
  // A non-zero META.offset must move the tick and its click target together.
  const { chart: workspaceChart } = canonicalChart();
  workspaceChart.META.offset = 500;
  workspaceChart.markers = [{ time: 1, name: "Offset marker" }];
  const created = await runner.callApi(
    `window.redux.document.create(${JSON.stringify({ name: "e2e-workspaces.json", chart: workspaceChart, replace: "discard" })})`,
  );
  runner.assert(created.ok === true, `workspace fixture create failed: ${JSON.stringify(created)}`);
  await runner.waitFor("marker ready", () =>
    runner.evaluate(`(() => {
      const state = window.redux.playback.state();
      return state?.ok === true && state.value.loaded && state.value.duration > 1.5 &&
        Boolean(document.querySelector('.timeline-marker[data-marker-time]'));
    })()`),
  );
  const marker = await runner.evaluate(`(() => {
    const root = document.querySelector('#timeline-markers');
    const button = document.querySelector('.timeline-marker[data-marker-time]');
    const rect = button?.getBoundingClientRect();
    return {
      time: Number(button?.dataset.markerTime),
      left: Number.parseFloat(button?.style.left ?? "NaN"),
      width: root?.clientWidth ?? 0,
      duration: window.redux.playback.state()?.value?.duration ?? 0,
      x: rect ? rect.left + rect.width / 2 : null,
      y: rect ? rect.top + rect.height / 2 : null,
    };
  })()`);
  const audioRatio = (1 + 0.5) / marker.duration;
  runner.assert(
    marker.time === 1 &&
      marker.x !== null &&
      marker.y !== null &&
      Math.abs(marker.left - audioRatio * marker.width) < 1,
    `marker tick did not apply META.offset: ${JSON.stringify({ marker, audioRatio })}`,
  );
  await clickPointer(runner, marker.x, marker.y);
  const seeked = await runner.callApi("window.redux.playback.state()");
  runner.assert(
    seeked.ok === true &&
      Math.abs(seeked.value.audioSeconds - 1.5) < 0.01 &&
      Math.abs(seeked.value.chartSeconds - 1) < 0.01,
    `marker click did not seek to marker time plus offset: ${JSON.stringify(seeked)}`,
  );

  const points = await runner.evaluate(`(() => {
    const centre = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    };
    return { notes: centre("#notes"), scrubber: centre(".scrubber-wrap") };
  })()`);
  runner.assert(points.notes && points.scrubber, `context-menu anchors: ${JSON.stringify(points)}`);
  await clickPointer(runner, points.notes.x, points.notes.y, "right");
  await runner.waitFor("timeline context menu", () =>
    runner.evaluate("Boolean(document.querySelector('.timeline-menu')?.matches(':popover-open'))"),
  );
  const timelineMenu = await runner.evaluate(`(() => {
    const binding = window.redux.values.byId.get("shortcut:edit.delete")[0] ?? "";
    const shortcuts = [...document.querySelectorAll(".timeline-menu .redux-menu-row-shortcut")].map((node) => node.textContent?.trim() ?? "");
    return { binding, shortcuts };
  })()`);
  runner.assert(
    timelineMenu.shortcuts.includes(timelineMenu.binding),
    `the timeline menu must show the live delete binding: ${JSON.stringify(timelineMenu)}`,
  );
  await runner.evaluate("document.querySelector('.timeline-menu')?.hidePopover(); true");
  await clickPointer(runner, points.scrubber.x, points.scrubber.y, "right");
  await runner.waitFor("progress context menu", () =>
    runner.evaluate(
      "Boolean(document.querySelector('[id=\"transport.jump\"]')?.closest('.redux-menu-popup')?.matches(':popover-open'))",
    ),
  );
  const progress = await runner.evaluate(
    `["transport.jump", "transport.markers"].map((id) => Boolean(document.querySelector('.redux-menu-popup [id="' + id + '"]')?.checkVisibility()))`,
  );
  runner.assert(progress.every(Boolean), `progress menu rows: ${JSON.stringify(progress)}`);
  await runner.evaluate(
    "document.querySelector('.redux-menu-popup [id=\"transport.jump\"]')?.closest('.redux-menu-popup')?.hidePopover(); true",
  );
  // The editor owns the stage; document-wide pages are drawer panes.
  runner.assert(
    (await runner.evaluate(
      "Boolean(document.querySelector('.workbench .workspace:not([hidden]) #stage'))",
    )) === true,
    "the editor must draw the stage",
  );
  const navigation = await runner.evaluate(`(() => ({
    sidebars: document.querySelectorAll('.sidebar').length,
    drawerRails: document.querySelectorAll('.drawer-rail').length,
    drawerEntries: document.querySelectorAll('.sidebar [data-drawer-pane]').length,
    metadata: document.querySelectorAll('.sidebar [data-pane="metadata"]').length,
  }))()`);
  runner.assert(
    navigation.sidebars === 1 &&
      navigation.drawerRails === 0 &&
      navigation.drawerEntries > 0 &&
      navigation.metadata === 1,
    `navigation is not a single merged sidebar: ${JSON.stringify(navigation)}`,
  );

  // The rail is permanently compact: pointer dwell, presses, and keyboard
  // focus must not widen it. Names come from the shared tooltip layer.
  await pressKey(runner, "Escape", "Escape", 27);
  await movePointer(runner, 2, 2);
  await runner.waitFor("sidebar at rest", async () => {
    const state = await railState(runner);
    return state !== null && !state.open && state.width <= 60;
  });
  const compactEntry = await railEntryPoint(runner, '.sidebar [data-pane="metadata"]');
  runner.assert(compactEntry !== null, "the metadata rail entry is missing");
  const frameBeforeHover = await frameGeometry(runner);
  await movePointer(runner, compactEntry.x, compactEntry.y);
  await delay(900);
  const hoveredRail = await railState(runner);
  const frameAfterHover = await frameGeometry(runner);
  runner.assert(
    hoveredRail !== null && !hoveredRail.open && hoveredRail.width <= 60,
    `pointer dwell must not expand the sidebar: ${JSON.stringify(hoveredRail)}`,
  );
  runner.assert(
    near(frameAfterHover.inspector?.width, frameBeforeHover.inspector?.width) &&
      near(frameAfterHover.workspace?.width, frameBeforeHover.workspace?.width) &&
      near(frameAfterHover.stage?.width, frameBeforeHover.stage?.width) &&
      near(frameAfterHover.timeline?.width, frameBeforeHover.timeline?.width),
    `the compact rail must not resize the inspector or workspace: ${JSON.stringify({ frameBeforeHover, frameAfterHover })}`,
  );
  const railEntryLabel = await runner.evaluate(
    `document.querySelector('.sidebar [data-pane="metadata"]')?.getAttribute('aria-label') ?? ''`,
  );
  runner.assert(railEntryLabel.trim().length > 0, "the metadata rail entry has no accessible name");
  await runner.waitFor("rail tooltip", () =>
    runner.evaluate(`(() => {
      const tip = document.querySelector('#redux-rich-tooltip');
      return tip?.matches(':popover-open') === true &&
        (tip.textContent ?? '').includes(${JSON.stringify(railEntryLabel)});
    })()`),
  );
  await clickPointer(runner, compactEntry.x, compactEntry.y);
  await delay(300);
  const pressedRail = await railState(runner);
  runner.assert(
    pressedRail !== null && !pressedRail.open && pressedRail.width <= 60,
    `a rail press must not expand the sidebar: ${JSON.stringify(pressedRail)}`,
  );
  await runner.evaluate(`document.querySelector('.sidebar [data-pane="metadata"]')?.focus(); true`);
  await pressKey(runner, "Tab", "Tab", 9);
  await delay(400);
  const keyboardRail = await railState(runner);
  runner.assert(
    keyboardRail !== null && !keyboardRail.open && keyboardRail.width <= 60,
    `keyboard focus must not expand the sidebar: ${JSON.stringify(keyboardRail)}`,
  );

  const panes = await drawerPaneIds(runner);
  runner.assert(panes.length > 0, `the drawer has no registered pages: ${JSON.stringify(panes)}`);
  runner.assert(
    JSON.stringify(panes) === JSON.stringify(["timing", "lines", "assets"]),
    `drawer pages are out of order: ${JSON.stringify(panes)}`,
  );

  const toolbar = await runner.evaluate(`(() => ({
    settings: document.querySelectorAll('.redux-toolbar [data-tip-action="workspace.settings"]').length,
    icons: [...document.querySelectorAll('.redux-toolbar-line > .redux-icon-button')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    }),
  }))()`);
  runner.assert(
    toolbar.settings === 1,
    `the toolbar should expose one settings control: ${JSON.stringify(toolbar)}`,
  );
  runner.assert(
    toolbar.icons.every((icon) => icon.width === icon.height),
    `toolbar icon buttons must be square: ${JSON.stringify(toolbar.icons)}`,
  );
  for (const pane of panes) {
    await openDrawerPane(runner, pane);
  }
  // The public SDK opens the same record the inspector paints: no hidden core
  // selection can disagree with the visible drawer.
  const sdkOpened = await runner.callApi('window.redux.workspace.openDrawerPane("timing")');
  runner.assert(sdkOpened === true, `SDK drawer open failed: ${JSON.stringify(sdkOpened)}`);
  await runner.waitFor("SDK drawer pane", () =>
    runner.evaluate(
      "Boolean(document.querySelector('#inspector.is-drawer [data-drawer-pane=\"timing\"] .drawer-split'))",
    ),
  );
  const sdkOpenState = await drawerSdkState(runner);
  runner.assert(
    sdkOpenState.selected === "timing" &&
      sdkOpenState.open &&
      sdkOpenState.split &&
      sdkOpenState.pane === "timing",
    `SDK selection and visible drawer disagree: ${JSON.stringify(sdkOpenState)}`,
  );
  await runner.callApi('window.redux.workspace.openInspector("metadata")');
  await runner.waitFor("drawer yields to metadata", () =>
    runner.evaluate(
      "!document.querySelector('#inspector.is-drawer') && Boolean(document.querySelector('#inspector [data-panel=metadata]:not([hidden])'))",
    ),
  );
  await openDrawerPane(runner, "lines");
  const sdkLinesState = await drawerSdkState(runner);
  runner.assert(
    sdkLinesState.selected === "lines" &&
      sdkLinesState.open &&
      sdkLinesState.split &&
      sdkLinesState.pane === "lines",
    `SDK selection and visible lines drawer disagree: ${JSON.stringify(sdkLinesState)}`,
  );
  // A document page still opens drawer mode; its header closes it and clears the inspector.
  await runner.evaluate(
    "document.querySelector('#inspector .inspector-status-close')?.click(); true",
  );
  await runner.waitFor("drawer closed", () =>
    runner.evaluate(
      "!document.querySelector('#inspector.is-drawer') && Boolean(document.querySelector('#inspector [data-panel=empty]:not([hidden])'))",
    ),
  );
  const closedState = await drawerSdkState(runner);
  runner.assert(
    closedState.selected === "lines" &&
      !closedState.open &&
      !closedState.split &&
      closedState.pane === "",
    `closed drawer still paints or forgot its page: ${JSON.stringify(closedState)}`,
  );
  // Metadata is an ordinary inspector pane: one form and no floating list.
  await runner.evaluate(
    "document.querySelector('.sidebar [data-pane=\"metadata\"]')?.click(); true",
  );
  await runner.waitFor("metadata inspector pane", () =>
    runner.evaluate(
      `Boolean(document.querySelector('#inspector [data-panel="metadata"]:not([hidden]) .metadata-panel-form'))`,
    ),
  );
  const metadata = await runner.evaluate(`(() => ({
    form: document.querySelectorAll('#inspector [data-panel="metadata"]:not([hidden]) .metadata-panel-form').length,
    split: document.querySelectorAll('#inspector .drawer-split-list').length,
    background: document.querySelectorAll('#inspector .metadata-resource-visual .metadata-resource-image').length,
    library: document.querySelectorAll('#inspector [data-panel="metadata"] .metadata-resource-row').length,
  }))()`);
  runner.assert(
    metadata.form === 1 && metadata.split === 0,
    `metadata is not a single inspector form: ${JSON.stringify(metadata)}`,
  );
  runner.assert(
    metadata.background === 1 && metadata.library === 0,
    `metadata resource cards are incomplete: ${JSON.stringify(metadata)}`,
  );

  const railTips = await runner.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.sidebar [data-pane], .sidebar [data-drawer-pane]')];
    return nodes.map((node) => ({
      id: node.dataset.pane ?? node.dataset.drawerPane ?? '',
      label: node.getAttribute('aria-label') ?? '',
      tip: node.dataset.tipTitle ?? '',
    }));
  })()`);
  runner.assert(railTips.length > 0, "the editor rail has no entries");
  for (const entry of railTips) {
    runner.assert(
      entry.id && entry.label.trim().length > 0 && entry.tip === entry.label,
      `every rail entry must expose its name as a tooltip: ${JSON.stringify(entry)}`,
    );
  }

  const railPanes = await runner.evaluate(`(() => {
    const nodes = [...document.querySelectorAll('.sidebar [data-pane]')];
    return nodes.map((node) => ({
      id: node.dataset.pane,
      label: node.getAttribute('aria-label') ?? '',
      tip: node.dataset.tipTitle ?? '',
    }));
  })()`);
  runner.assert(railPanes.length > 0, "the editor rail has no registered panes");
  for (const pane of railPanes) {
    runner.assert(
      pane.id && pane.label.trim().length > 0 && pane.tip.trim().length > 0,
      `rail pane needs an id, accessible label, and tooltip: ${JSON.stringify(pane)}`,
    );
    await runner.evaluate(
      `document.querySelector('.sidebar [data-pane=${JSON.stringify(pane.id)}]')?.click(); true`,
    );
    await runner.waitFor(
      `inspector pane ${pane.id}`,
      () =>
        runner.evaluate(
          `Boolean(document.querySelector('#inspector [data-panel=${JSON.stringify(pane.id)}]:not([hidden])'))`,
        ),
      Date.now() + 8_000,
    );
  }
  // A pane opens on the next frame; give React one turn before closing.
  await delay(50);

  await closeDocument(runner);
  await assertHomeScreen(runner);
}
