/**
 * Build modes for `npm run build`, kept out of the build script so the accepted
 * flags, their conflicts, and the help text can be unit-tested and read in one
 * place.
 *
 * The contract is deliberately small: one output mode (`--debug` or
 * `--portable`), one optional compiler profile (`--fast`), and one optional
 * download skip (`--without-bundled-tools`). Anything else is rejected rather
 * than silently ignored.
 */
import { SKIP_BUNDLED_TOOLS_FLAG } from "./bundledTools.mjs";

/** Flags that select the build output. At most one may be present. */
export const OUTPUT_FLAGS = Object.freeze(["--debug", "--portable"]);

/** The optional release compiler profile. */
export const PROFILE_FLAGS = Object.freeze(["--fast"]);

/** Flags that change which build inputs are staged. */
export const INPUT_FLAGS = Object.freeze([SKIP_BUNDLED_TOOLS_FLAG]);

/** The help text printed by `npm run build -- --help`. */
export const BUILD_HELP = `Usage: npm run build -- [flags]

Build the desktop application. No flag produces the release installer and the
staged portable folder.

  --debug                     Debug executable without an installer, for smoke tests.
  --portable                  Staged portable folder without an installer.
  --fast                      Thin LTO and parallel codegen; release-shaped, not for publishing.
  --without-bundled-tools     Skip the FFmpeg and Cloudflare Tunnel downloads; those
                              features report a warning at runtime.
  --help, -h                  Show this help.

--debug cannot be combined with --portable or --fast.
`;

/**
 * Parse the arguments after `npm run build --`.
 *
 * @returns `{ help: true }` when help was requested, otherwise the selected
 * output mode, whether the fast release profile is active, and whether the
 * pinned tool downloads are skipped.
 * @throws when a flag is unknown or two output flags are combined.
 */
export function parseBuildFlags(argv) {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  const known = [...OUTPUT_FLAGS, ...PROFILE_FLAGS, ...INPUT_FLAGS];
  const unknown = args.find((argument) => !known.includes(argument));
  if (unknown) {
    throw new Error(`Unknown build flag: ${unknown}. Use ${known.join(", ")}, or --help.`);
  }

  const outputs = OUTPUT_FLAGS.filter((flag) => args.includes(flag));
  if (outputs.length > 1) {
    throw new Error("--debug and --portable cannot be used together.");
  }
  const fast = args.includes("--fast");
  if (fast && outputs.includes("--debug")) {
    throw new Error("--debug and --fast cannot be used together.");
  }

  return {
    help: false,
    mode: outputs[0] === "--debug" ? "debug" : outputs[0] === "--portable" ? "portable" : "release",
    fast,
    bundledTools: !args.includes(SKIP_BUNDLED_TOOLS_FLAG),
  };
}
