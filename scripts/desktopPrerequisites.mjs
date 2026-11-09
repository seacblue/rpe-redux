/**
 * The native resources both `npm run dev:desktop` and `npm run build` need before
 * Tauri starts. Keeping the list here means a new download or sidecar build is
 * added once instead of in two scripts.
 */
import { join } from "node:path";
import { runBuildPrerequisites } from "./buildPrerequisites.mjs";

/** Stage FFmpeg, Cloudflared, and the embedded Go service, in parallel. */
export function prepareDesktopPrerequisites(root) {
  return runBuildPrerequisites(
    [
      join(root, "scripts", "prepareFfmpeg.mjs"),
      join(root, "scripts", "prepareCloudflared.mjs"),
      join(root, "src", "backend", "build.ts"),
    ],
    root,
  );
}
