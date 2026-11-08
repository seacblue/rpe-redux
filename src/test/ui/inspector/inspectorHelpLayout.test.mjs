import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const inspectorSource = read("frontend/screens/editor/inspector/InspectorPanel.tsx");
const onboardingStyles = read("frontend/onboarding/onboarding.less");
const drawerSource = read("frontend/chrome/drawer/drawerPanes.ts");
const drawerStyles = read("frontend/chrome/drawer/drawer.less");
const themeChromeStyles = read("frontend/app/themeChrome.less");
const fieldStyles = read("design/components/field/field.less");

test("the empty inspector starts with navigation instead of a duplicate header", () => {
  assert.doesNotMatch(inspectorSource, /inspector-empty-status/u);
});

test("drawer destinations can own their anchored tutorials", () => {
  assert.match(drawerSource, /tutorial\?: HelpTutorialDefinition/u);
  assert.match(drawerSource, /registerHelpTutorial\(pane\.tutorial\)/u);
});

test("drawer list footers share the inspector inset", () => {
  const footerRule = drawerStyles.match(/\.drawer-split-list \.redux-footer-bar \{([\s\S]*?)\}/u);
  assert.ok(footerRule);
  assert.match(footerRule[1], /margin-inline:\s*var\(--inspector-gutter\);/u);
  assert.match(footerRule[1], /padding-bottom:\s*var\(--inspector-gutter\);/u);
});

test("drawer surfaces follow the active chrome material", () => {
  assert.match(
    drawerStyles,
    /--drawer-surface:\s*color-mix\(in srgb, var\(--chrome-panel-surface\) 78%, transparent\);/u,
  );
  const drawerRule = themeChromeStyles.match(
    /\.redux-app-root \.workbench-inspector > \.inspector\.is-drawer \{([\s\S]*?)\}/u,
  );
  assert.ok(drawerRule);
  assert.match(drawerRule[1], /background:\s*var\(--drawer-surface\);/u);
  assert.doesNotMatch(drawerRule[1], /background:\s*var\(--surface-raised\);/u);
});

test("onboarding geometry moves without replaying the dimming animation", () => {
  assert.match(onboardingStyles, /transition:\s*(?:left|all)[^;]*;/u);
  for (const className of ["spotlight", "scrim"]) {
    const block = onboardingStyles.match(
      new RegExp(`\\.redux-onboarding-${className} \\{([\\s\\S]*?)\\}`, "u"),
    );
    assert.ok(block, className);
    assert.doesNotMatch(block[1], /animation:/u, className);
  }
});

test("chart data fields do not expose reset actions", () => {
  for (const path of [
    "screens/editor/chartMetadata/MetadataFields.tsx",
    "screens/editor/inspector/bpm/BpmPanel.tsx",
    "screens/global/sections/lines/linePanelResets.tsx",
  ]) {
    assert.doesNotMatch(read(`frontend/${path}`), /FieldReset|reset=/u, path);
  }
});

test("only the explicit inspector reset allowlist exposes reset affordances", () => {
  const fieldReset = read("design/components/field/FieldReset.tsx");
  for (const key of [
    "result-ghost",
    "preview-line-only",
    "loop-ab",
    "show-grid",
    "grid-distance",
    "cut-density",
    "fit",
    "fit-precision",
    "auto-approve-editor",
    "auto-bitrate",
  ]) {
    assert.ok(fieldReset.includes(`| "${key}"`), key);
  }
  for (const path of [
    "screens/editor/inspector/events/EventField.tsx",
    "screens/editor/inspector/events/EventInspectorView.tsx",
    "screens/editor/inspector/notes/NotePropertiesView.tsx",
    "screens/editor/inspector/sampling/SamplingInspector.tsx",
    "screens/editor/inspector/trajectory/TrajectoryFieldsView.tsx",
    "screens/editor/inspector/scripts/ParameterForm.tsx",
    "screens/editor/inspector/multiLine/MultiLinePanel.tsx",
  ]) {
    assert.doesNotMatch(read(`frontend/${path}`), /FieldReset|redux-setting-reset/u, path);
  }
  assert.match(
    read("frontend/screens/editor/inspector/curveNotes/CurveFieldsView.tsx"),
    /field="result-ghost"/u,
  );
  assert.match(
    read("frontend/screens/editor/inspector/multiEdit/MultiEditForm.tsx"),
    /field="result-ghost"/u,
  );
  assert.match(
    fieldStyles,
    /\.redux-app-root \.redux-field-row \.redux-icon-button\.redux-field-reset[\s\S]*?height:\s*var\(--control-height-compact\);/u,
  );
});

test("note rendering does not paint a frame around selected or overlapping notes", () => {
  const noteSource = read("frontend/screens/editor/workspace/timeline/notes/noteDrawing.ts");
  assert.doesNotMatch(noteSource, /options\.overlapping[\s\S]*?strokeRect/u);
  assert.doesNotMatch(noteSource, /overlayInvalidStroke/u);
});
