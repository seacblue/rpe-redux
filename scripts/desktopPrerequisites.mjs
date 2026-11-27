/**
 * The native resources both `npm run dev:desktop` and `npm run build` need before
 * Tauri starts. Keeping the list here means a new download or sidecar build is
 * added once instead of in two scripts.
 */
import { join } from "node:path";
import { runBuildPrerequisites } from "./buildPrerequisites.mjs";

/**
 * Scripts that run before Tauri starts.
 *
 * The Go sidecar is always built; local helper staging never performs a latest
 * lookup, while release CI opts into the latest FFmpeg and Cloudflare Tunnel
 * downloads through REDUX_RELEASE_BUILD.
 */
export function desktopPrerequisiteScripts(root, { bundledTools = true } = {}) {
  const scripts = [];
  if (bundledTools) {
    scripts.push(
      join(root, "scripts", "prepareFfmpeg.mjs"),
      join(root, "scripts", "prepareCloudflared.mjs"),
    );
  }
  scripts.push(join(root, "src", "backend", "build.ts"));
  return scripts;
}

/** Stage the requested prerequisites, in parallel. */
export function prepareDesktopPrerequisites(root, options = {}) {
  return runBuildPrerequisites(desktopPrerequisiteScripts(root, options), root);
}
