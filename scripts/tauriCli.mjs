/**
 * The single Tauri CLI entry used by both the desktop development loop and the
 * release builder, so Windows command-shell handling lives in one place.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** The JavaScript entry point of the locally installed Tauri CLI. */
function tauriEntry(root) {
  return join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
}

/** Run the locally installed Tauri CLI and exit on failure. */
export function runTauri(root, args) {
  // Invoke Node with an argument vector instead of passing the CLI path through
  // a command shell. This keeps spaces and shell metacharacters in the project
  // path data, not executable syntax.
  const result = spawnSync(process.execPath, [tauriEntry(root), ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
