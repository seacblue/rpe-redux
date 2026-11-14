/** Cover-background wiring for the home page and editor. */
import assert from "node:assert/strict";
import test from "node:test";
import { COVER_BACKGROUND_KEYS } from "../../../core/settings/features/coverBackground.ts";
import "../../../core/settings/features/appearance.ts";
import { settingsRegistry } from "../../../core/settings/settings.ts";
import { editorCoverUrl, editorDocumentCoverUrl } from "../../../frontend/app/coverBackdropUrl.ts";
import { resourceReferences } from "../../../core/global/document/resources.ts";

test("the editor cover URL prefers the library project, then document assets", () => {
  assert.equal(
    editorCoverUrl("http://127.0.0.1:47821", "project-a", "cover art.png"),
    "http://127.0.0.1:47821/api/projects/project-a/assets/cover%20art.png",
  );
  assert.equal(editorCoverUrl("http://127.0.0.1:47821", "", "cover.png"), "");
  assert.equal(editorCoverUrl("http://127.0.0.1:47821", "project-a", "   "), "");
  assert.equal(
    editorCoverUrl("http://127.0.0.1:47821", "", "https://example.com/cover.png"),
    "https://example.com/cover.png",
  );
  const assets = new Map([["cover.png", new Uint8Array()]]);
  assets.uri = (name) => `http://redux.localhost/doc/${name}`;
  assert.equal(
    editorCoverUrl("http://127.0.0.1:47821", "", "cover.png", assets, "chart.json"),
    "http://redux.localhost/doc/cover.png",
  );
});

test("the editor cover URL resolves an inferred document image", () => {
  const assets = new Map([["cover.png", new Uint8Array()]]);
  assets.uri = (name) => `http://redux.localhost/doc/${name}`;
  assert.equal(
    editorDocumentCoverUrl(
      "http://127.0.0.1:47821",
      "",
      { META: { background: "" } },
      assets,
      "chart.json",
    ),
    "http://redux.localhost/doc/cover.png",
  );
});

test("generated library thumbnails are not inferred as chart backgrounds", () => {
  const assets = new Map([
    ["__redux/thumbnail.png", new Uint8Array()],
    ["cover.png", new Uint8Array()],
  ]);
  assert.equal(
    resourceReferences({ META: { background: "", song: "" } }, assets, "chart.json").background,
    "cover.png",
  );
});

test("the welcome and editor controls register independently", () => {
  for (const key of [
    COVER_BACKGROUND_KEYS.welcomeEnabled,
    COVER_BACKGROUND_KEYS.welcomeBlur,
    COVER_BACKGROUND_KEYS.welcomeBrightness,
    COVER_BACKGROUND_KEYS.editorWindowEnabled,
    COVER_BACKGROUND_KEYS.editorWindowBlur,
    COVER_BACKGROUND_KEYS.editorWindowBrightness,
    COVER_BACKGROUND_KEYS.editorPreviewEnabled,
  ]) {
    const definition = settingsRegistry.definition(key);
    assert.ok(definition, `missing setting ${key}`);
    assert.equal(definition.navigation, "appearance.display");
    assert.equal(definition.group, "settings.group.coverBackground");
  }
  assert.equal(
    settingsRegistry.definition(COVER_BACKGROUND_KEYS.welcomeBlur)?.enabledWhen?.key,
    COVER_BACKGROUND_KEYS.welcomeEnabled,
  );
  assert.equal(
    settingsRegistry.definition(COVER_BACKGROUND_KEYS.editorWindowBlur)?.enabledWhen?.key,
    COVER_BACKGROUND_KEYS.editorWindowEnabled,
  );
  assert.equal(
    settingsRegistry.definition(COVER_BACKGROUND_KEYS.editorPreviewEnabled)?.default,
    true,
  );
  assert.equal(
    settingsRegistry.definition("background-blur")?.enabledWhen?.key,
    COVER_BACKGROUND_KEYS.editorPreviewEnabled,
  );
});
