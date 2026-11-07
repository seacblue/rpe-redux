/**
 * Document-error UX keeps resource policy, explanations, solutions, and codes
 * aligned with the native document operation that failed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { setLanguage, t } from "../../../i18n/index.ts";
import {
  localizeOpenError,
  localizeSaveError,
} from "../../../core/platform/desktop/documentStore.ts";

test("unsafe_save_asset_path tells the author to copy external files into the folder", () => {
  setLanguage("en");
  const failure = localizeSaveError(new Error("unsafe_save_asset_path"));
  assert.equal(failure.code, "unsafe_save_asset_path");
  assert.match(failure.message, /outside its folder/i);
  assert.match(failure.message, /Copy external resources into the chart folder/i);

  setLanguage("zh");
  const chinese = localizeSaveError("unsafe_save_asset_path");
  assert.equal(chinese.code, "unsafe_save_asset_path");
  assert.match(chinese.message, /文档目录外/);
  assert.match(chinese.message, /复制到谱面目录/);

  setLanguage("en");
});

test("missing image and music notices mention the external-file policy", () => {
  setLanguage("en");
  assert.match(
    t("system.image.missing", { name: "bg.png" }),
    /external files are not loaded by default/i,
  );
  assert.match(
    t("editor.app.status.musicMissing", { name: "song.ogg" }),
    /outside the chart folder are not loaded by default/i,
  );

  setLanguage("zh");
  assert.match(t("system.image.missing", { name: "bg.png" }), /外部文件默认不会加载/);
  assert.match(t("editor.app.status.musicMissing", { name: "song.ogg" }), /文档目录外/);

  setLanguage("en");
});

test("failed opens describe the matching limit and do not add an unrelated policy hint", () => {
  setLanguage("en");
  const failure = localizeOpenError(new Error("pez_chart_size_limit"));
  assert.equal(failure.code, "pez_chart_size_limit");
  assert.match(failure.message, /512 MiB/);
  assert.match(failure.solution, /compact|reduce|split/i);
  assert.doesNotMatch(failure.message, /External files are not loaded by default/);
  assert.doesNotMatch(failure.solution, /External files are not loaded by default/);
  assert.equal(localizeOpenError(failure).message, failure.message);
});

test("failed saves describe the matching limit and preserve the stable code", () => {
  setLanguage("zh");
  const failure = localizeSaveError(new Error("chart_too_large"));
  assert.equal(failure.code, "chart_too_large");
  assert.match(failure.message, /512 MiB/);
  assert.match(failure.solution, /精简|拆分|压缩/);
  setLanguage("en");
});

test("unknown document failures keep diagnostics and provide a general solution", () => {
  setLanguage("en");
  const failure = localizeOpenError(new Error("The chart format is invalid."));
  assert.equal(failure.code, undefined);
  assert.equal(failure.message, "The chart format is invalid.");
  assert.match(failure.solution, /file exists|supported/i);
});

test("a superseded open keeps its AbortError identity", () => {
  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  assert.equal(localizeOpenError(abort), abort);
});
