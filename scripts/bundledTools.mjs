/**
 * The optional third-party tools a desktop build can leave out.
 *
 * FFmpeg powers chart export and the Cloudflare Tunnel client publishes a room
 * beyond the local network. Release builds resolve both from their vendors'
 * latest stable releases; local builds can keep them out entirely, so testing
 * unrelated work never depends on a network download.
 */

/** Build flag that keeps optional third-party tools out of a build. */
export const SKIP_BUNDLED_TOOLS_FLAG = "--without-bundled-tools";

/**
 * Note left in a resource folder whose tool was not staged.
 *
 * The bundle resource globs need at least one match and the packaged folder then
 * explains itself; `src-tauri/build.rs` writes the same file for a bare cargo
 * build, and each staging script removes it when it stages the real tool.
 */
export const SKIPPED_TOOL_NOTE = "NOT-BUNDLED.txt";
