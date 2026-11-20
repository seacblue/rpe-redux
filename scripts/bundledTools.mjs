/**
 * The optional third-party tools a desktop build can leave out.
 *
 * FFmpeg powers chart export and the Cloudflare Tunnel client publishes a room
 * beyond the local network. Both are pinned downloads, so a build that tests
 * unrelated work can skip them; the host then reports the two features as
 * unavailable instead of failing.
 */

/** Build flag that keeps the pinned tools out of a build. */
export const SKIP_BUNDLED_TOOLS_FLAG = "--without-bundled-tools";

/**
 * Note left in a resource folder whose tool was not staged.
 *
 * The bundle resource globs need at least one match and the packaged folder then
 * explains itself; `src-tauri/build.rs` writes the same file for a bare cargo
 * build, and each staging script removes it when it stages the real tool.
 */
export const SKIPPED_TOOL_NOTE = "NOT-BUNDLED.txt";
