/** Component-to-component hosts come from React context, not DOM searches. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const portalHost = read("design/patterns/portalHost.tsx");
const main = read("main.tsx");
const modal = read("design/components/modal/Modal.tsx");
const controlHost = read("design/controls/ControlHost.tsx");
const popconfirm = read("design/components/popconfirm/Popconfirm.tsx");
const libraryPanel = read("frontend/screens/welcome/library/LibraryPanel.tsx");
const texturePicker = read("frontend/screens/global/sections/lines/TexturePicker.tsx");
const shaderFocus = read("frontend/screens/editor/inspector/events/shader/shaderFocus.tsx");
const shaderView = read("frontend/screens/editor/inspector/events/shader/ShaderInspectorView.tsx");
const shaderFields = read("frontend/screens/editor/inspector/events/shader/ShaderPanelFields.tsx");
const freeCamera = read("frontend/screens/editor/workspace/stage/freeCamera/FreeCameraOverlay.tsx");
const curveOverlay = read("frontend/screens/editor/curveEvents/CurveEventsOverlay.tsx");
const curveDock = read("frontend/screens/editor/curveEvents/CurveToolDock.tsx");
const curveDockHook = read("frontend/screens/editor/curveEvents/useCurveToolDock.ts");
const treeFolder = read("design/patterns/tree/TreeFolder.tsx");
const lineTreeRows = read("frontend/screens/global/sections/lines/LineTreeRows.tsx");

test("the app root and nearest modal are provided through React context", () => {
  assert.match(portalHost, /export function PortalHostProvider/u);
  assert.match(portalHost, /export function useAppRootHost/u);
  assert.match(portalHost, /export function useOverlayHost/u);
  assert.match(main, /<PortalHostProvider host=\{container\}>/u);
  assert.match(modal, /<PortalHostProvider modalHost=\{dialogElement\}>/u);
});

test("portal owners read their host from context instead of searching ancestors", () => {
  for (const source of [controlHost, libraryPanel, texturePicker]) {
    assert.match(source, /useAppRootHost/u);
    assert.doesNotMatch(source, /\.closest\("\.redux-app-root"\)/u);
  }
  assert.match(popconfirm, /useOverlayHost/u);
  assert.doesNotMatch(popconfirm, /\.closest\("dialog\[open\]"\)/u);
  assert.doesNotMatch(popconfirm, /\.closest\("\.redux-app-root"\)/u);
});

test("tree headers select through their owning component, not event target lookup", () => {
  assert.match(treeFolder, /onHeaderClick/u);
  assert.match(lineTreeRows, /onHeaderClick=\{onHeaderClick\}/u);
  assert.doesNotMatch(lineTreeRows, /\.closest\(/u);
});

test("overlays own their dock interactions through React props", () => {
  assert.doesNotMatch(freeCamera, /\.closest\("\.free-camera-dock"\)/u);
  assert.match(freeCamera, /className="free-camera-dock"[\s\S]*?onPointerDown=/u);
  assert.doesNotMatch(curveOverlay, /\.closest\("\.curve-tool-dock"\)/u);
  assert.match(curveOverlay, /toolDockHovered\.current/u);
  assert.match(curveDock, /onHoverChange/u);
  assert.match(curveDock, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/u);
  assert.doesNotMatch(curveDockHook, /\.closest\(/u);
});

test("shader fields read focus ownership from their React parent", () => {
  assert.match(shaderFocus, /ShaderInspectorFocusProvider/u);
  assert.match(shaderFocus, /onFocusCapture/u);
  assert.match(shaderFocus, /onBlurCapture/u);
  assert.match(shaderView, /<ShaderInspectorFocusProvider>/u);
  assert.match(shaderFields, /useShaderInspectorFocus/u);
  assert.doesNotMatch(shaderFields, /\.closest\(|\.contains\(/u);
});
