/** Asset audio preview: no spectrum bars, no bright plate, and Space previews it. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { claimKey, registerKeyClaim } from "../../../frontend/platform/shortcuts/keyClaims.ts";

const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const audioPlayerSource = read("design/components/audio/AudioPlayer.tsx");
const audioStyles = read("design/components/audio/audioPlayer.less");
const assetsSource = read("frontend/screens/global/sections/assets/AssetLibraryView.tsx");
const assetsStyles = read("frontend/screens/global/sections/assets/assetLibrary.less");
const pageStyles = read("frontend/chrome/inspectorPage/inspectorPage.less");
const editorKeyboardSource = read("frontend/platform/shortcuts/editorKeyboard.ts");
const assetRuntime = read("frontend/screens/global/sections/assets/assetLibraryRuntime.ts");
const assetModel = read("frontend/screens/global/sections/assets/assetLibrary.ts");
const englishPanels = read("i18n/messages/en/editorPanels.ts");
const chinesePanels = read("i18n/messages/zh/editorPanels.ts");

const shortcutContext = {
  atHome: false,
  documentOpen: true,
  modal: "none",
  capturing: false,
  developerMode: false,
  textEntry: false,
  surface: null,
};

test("a surface claim runs before the editor dispatcher and can be released", () => {
  const seen = [];
  const release = registerKeyClaim((event) => {
    seen.push(event.key);
    return event.key === " ";
  });

  assert.equal(claimKey({ key: " " }, shortcutContext), true);
  assert.equal(claimKey({ key: "A" }, shortcutContext), false);
  release();
  assert.equal(claimKey({ key: " " }, shortcutContext), false);
  assert.deepEqual(seen, [" ", "A"]);
});

test("audio previews render no live spectrum bars", () => {
  assert.doesNotMatch(audioPlayerSource, /AudioSpectrum|redux-audio-spectrum/u);
  assert.doesNotMatch(audioStyles, /redux-audio-spectrum/u);
});

test("audio rows and previews drop their bright surfaces", () => {
  assert.match(assetsSource, /data-asset-kind=\{file\.kind\}/u);
  assert.match(
    assetsStyles,
    /\.asset-row\[data-asset-kind="audio"\]\.is-selected \{\s*background: transparent;/u,
  );
  assert.match(
    assetsStyles,
    /\.asset-details > \.redux-audio > \.redux-audio-frame \{\s*background: transparent;/u,
  );
});

test("Space toggles the visible audio preview instead of the chart transport", () => {
  assert.match(assetsSource, /return registerKeyClaim\(\(event, context\) => \{/u);
  assert.match(assetsSource, /player\.toggle\(\);\s*return true;/u);
  assert.match(assetsSource, /context\.textEntry/u);
  assert.match(assetsSource, /context\.surface !== null/u);
  assert.match(assetsSource, /selected\?\.kind !== "audio" \|\| !assetsActive/u);
  assert.doesNotMatch(assetsSource, /audioFocus|onAudioFocusChange|onFocusChange/u);
  assert.doesNotMatch(
    assetsSource,
    /\.closest\(|\.contains\(|offsetParent|document\.body|event\.target/u,
  );
  assert.match(editorKeyboardSource, /claimKey\(event, context\) \|\| deps\.claimDraftShortcut/u);
});

test("only the asset title keeps a text margin", () => {
  assert.match(
    pageStyles,
    /\.inspector-page-split-bottom > \.inspector-page-content \{\s*padding-top: var\(--space-2\);/u,
  );
  assert.match(assetsStyles, /\.inspector-page-split \.asset-details \{\s*margin: 0;\s*\}/u);
  assert.match(
    assetsStyles,
    /\.inspector-page-split \.asset-details-name \{\s*margin: 0 var\(--space-2\);/u,
  );
});

test("the rename prompt carries no asset-kind description", () => {
  assert.doesNotMatch(assetModel, /assetLibrary\.rename\.description/u);
  assert.doesNotMatch(englishPanels, /assetLibrary\.rename\.description/u);
  assert.doesNotMatch(chinesePanels, /assetLibrary\.rename\.description/u);
});

test("library assets fall back to the staged external-open command", () => {
  assert.match(assetRuntime, /currentDocumentStore\(\)\?\.current/u);
  assert.match(assetRuntime, /open_asset_external_bytes/u);
  assert.match(assetRuntime, /assets\.read\?\.\(name\)/u);
});
