/**
 * The restore dialog asks two questions in order: which backup, then whether the
 * current chart is kept. The footer must offer exactly the three answers the
 * product promises — cancel, do not save, save — and the cancel answer must take
 * the whole question down rather than stepping back to the list.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dialog = await readFile(
  new URL(
    "../../../frontend/screens/editor/workspace/document/restore/RestoreBackupDialog.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("the confirmation footer offers cancel, do not save, and save", () => {
  const footer = dialog.slice(dialog.indexOf("function RestoreConfirmActions"));
  assert.match(footer, /common\.action\.cancel/u);
  assert.match(footer, /editor\.dialogs\.restoreBackup\.discard/u);
  assert.match(footer, /common\.action\.save/u);
  assert.equal(
    (footer.match(/resolveRestore\(host, "/gu) ?? []).length,
    2,
    "only the two restore answers resolve the question",
  );
});

test("cancel closes the question instead of returning to the list", () => {
  const footer = dialog.slice(dialog.indexOf("function RestoreConfirmActions"));
  const cancel = footer.indexOf("common.action.cancel");
  const button = footer.slice(footer.lastIndexOf("<Button", cancel), cancel);
  assert.match(button, /closeRestorePrompt/u);
});

test("the list shows the saved time, note count, and event count", () => {
  const list = dialog.slice(
    dialog.indexOf("function BackupList"),
    dialog.indexOf("function BackupSummary"),
  );
  assert.match(list, /formatSnapshotTime\(snapshot\.createdAt\)/u);
  assert.match(list, /editor\.dialogs\.restoreBackup\.counts/u);
  assert.match(list, /notes: snapshot\.noteCount/u);
  assert.match(list, /events: snapshot\.eventCount/u);
});

test("the list shows how long the chart had been worked on", () => {
  const list = dialog.slice(
    dialog.indexOf("function BackupList"),
    dialog.indexOf("function BackupSummary"),
  );
  assert.match(list, /formatChartingTime\(snapshot\.editSeconds\)/u);
  // A node written before the service recorded the time reads back as zero, and
  // showing "0s of work" for it would be a lie rather than an absence.
  assert.match(list, /snapshot\.editSeconds > 0/u);
});

test("the list carries no reason badge and no unsaved warning", () => {
  // The dialog states what a backup is by its facts, not by a label or a warning
  // that repeats what the two footer answers already say.
  assert.doesNotMatch(dialog, /restoreBackup\.reasonRestore/u);
  assert.doesNotMatch(dialog, /restoreBackup\.unsavedWarning/u);
});

test("the footer is disabled while a restore is in flight", () => {
  const footer = dialog.slice(dialog.indexOf("function RestoreConfirmActions"));
  const disabled = (footer.match(/disabled=\{pending\}/gu) ?? []).length;
  assert.equal(disabled, 3, "every answer must be disabled while one is running");
});

test("resolving twice cannot start a second restore", async () => {
  const source = await readFile(
    new URL(
      "../../../frontend/screens/editor/workspace/document/restore/restorePrompt.ts",
      import.meta.url,
    ),
    "utf8",
  );
  // The guard is what makes a double click harmless, so pin its presence.
  assert.match(source, /current\.pending\)\s*\{\s*return;/u);
  assert.match(source, /pending: true/u);
});

test("a failure reports that nothing changed", async () => {
  const source = await readFile(
    new URL(
      "../../../frontend/screens/editor/workspace/document/restore/restorePrompt.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /editor\.dialogs\.restoreBackup\.failed/u);
});
