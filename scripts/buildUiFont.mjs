/**
 * Rebuild the shipped CJK interface slices from the text the interface can paint.
 *
 * The full Source Han Sans CN face is a regeneration source, not a shipped
 * asset: it is 8 MiB and every web visit would download it. This script collects
 * the interface, theme, Extension, and skin text under `src/`, then asks
 * scripts/buildUiFont.py to write:
 * - a small WOFF2 subset for the interface, loaded after the shell mounts;
 * - unicode-range CJK slices, loaded by the browser only for characters a user
 *   actually enters.
 *
 * Requires Python 3 with fontTools and brotli. Run `npm run build:font` after
 * changing UI text.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fullFont = join(root, "scripts", "fonts", "SourceHanSansCN-Regular.otf");
const fontsDir = join(root, "src", "public", "assets", "fonts");
const output = join(fontsDir, "SourceHanSansCN-UI.woff2");
const cssFile = join(root, "src", "design", "styles", "uiFontFaces.less");
const textRoots = [join(root, "src"), join(root, "index.html")];
const textExtensions = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".json",
  ".html",
  ".less",
  ".css",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".svg",
]);
const skippedDirectories = new Set(["test", "backend"]);

/** Collect every text file the interface can draw, skipping binaries. */
async function collectText() {
  const texts = [];
  const visit = async (path) => {
    const info = await stat(path);
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
          continue;
        }
        await visit(join(path, entry.name));
      }
      return;
    }
    if (!info.isFile() || !textExtensions.has(extname(path).toLowerCase())) {
      return;
    }
    const contents = await readFile(path, "utf8");
    if (contents.includes("\0")) {
      return;
    }
    texts.push(contents);
  };
  for (const path of textRoots) {
    await visit(path);
  }
  return texts;
}

/** Count distinct CJK ideographs so the build log says what was included. */
function distinctCjk(text) {
  const cjk = /[\u3400-\u9fff]/gu;
  return new Set(text.match(cjk) ?? []).size;
}

const texts = await collectText();
const text = texts.join("\n");

let fullSize;
try {
  fullSize = (await stat(fullFont)).size;
} catch {
  throw new Error(`Missing full font source at ${relative(root, fullFont)}`);
}

const work = await mkdtemp(join(tmpdir(), "redux-font-"));
const textFile = join(work, "ui-text.txt");
try {
  await writeFile(textFile, text, "utf8");
  const python = process.env.PYTHON ?? "python";
  const result = spawnSync(
    python,
    [
      join(root, "scripts", "buildUiFont.py"),
      "--full",
      fullFont,
      "--text",
      textFile,
      "--out-dir",
      fontsDir,
      "--css",
      cssFile,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Font slice generation failed with exit code ${result.status}`);
  }
  const prettier = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["prettier", "--write", cssFile],
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (prettier.error) {
    throw prettier.error;
  }
  if (prettier.status !== 0) {
    throw new Error(`Formatting generated font CSS failed with exit code ${prettier.status}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

const subsetSize = (await stat(output)).size;
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
const percent = ((subsetSize / fullSize) * 100).toFixed(1);
console.log(
  `UI font: ${mb(fullSize)} -> ${mb(subsetSize)} (${percent}%), ` +
    `${texts.length} text files, ${distinctCjk(text)} distinct CJK ideographs.`,
);
