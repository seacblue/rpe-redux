/**
 * Builds the bundled icon sets that ship inside the theme packages.
 *
 * Source artwork comes from Lucide's 24x24 outline set and Microsoft's Fluent
 * UI System Icons for the window-caption glyphs. Each glyph is rendered to a
 * 192x192 alpha mask; the runtime keeps that alpha and replaces the ink with
 * the active theme token, so one shape works on every surface. The two packages
 * differ in optical weight rather than colour: dark uses the library's 2px
 * stroke, light uses 1.75px because dark ink on a light surface reads heavier at
 * the same size.
 *
 * `src/design/components/icon/iconAssets.ts` is the published name/path
 * catalog. This script is the only writer of the theme PNGs and of the `icons`
 * maps in their package manifests; stale files are pruned so the packages cannot
 * drift from the catalog.
 *
 * Usage:
 *   npm run build:icons
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ICON_SOURCES } from "./iconSources.mjs";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const SOURCE = join(ROOT, "src", "design", "components", "icon", "iconAssets.ts");
const SOURCE_SVG = {
  lucide: join(ROOT, "scripts", "icon-sources", "lucide"),
  fluent: join(ROOT, "scripts", "icon-sources", "fluent"),
};
const THEMES = [
  { id: "dark", ink: "#ffffff", stroke: 2 },
  { id: "light", ink: "#000000", stroke: 1.75 },
];

/** Read the name/path pairs from the icon catalog literal. */
function catalog() {
  const text = readFileSync(SOURCE, "utf8");
  const entries = [...text.matchAll(/^\s*(\w+):\s*"([^"]+)",?$/gm)].map(([, name, path]) => [
    name,
    path,
  ]);
  if (!entries.length) {
    throw new Error(`No icon entries found in ${SOURCE}`);
  }
  return entries;
}

/** Read the SVG source for one catalog entry. */
function sourceSvg(entry) {
  const source = typeof entry === "string" ? { collection: "lucide", name: entry } : entry;
  const path = join(SOURCE_SVG[source.collection], `${source.name}.svg`);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`Missing ${source.collection} icon source ${source.name}.svg (${path})`);
  }
  return text;
}

/** Rasterize one SVG to a 192x192 alpha mask in the theme's stroke weight. */
async function render(svg, ink, stroke) {
  const prepared = svg
    .replaceAll("currentColor", ink)
    .replace(/stroke-width="[^"]+"/g, `stroke-width="${stroke}"`);
  return sharp(Buffer.from(prepared), { density: 576 })
    .resize(192, 192, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** List every PNG below a directory as a forward-slash relative path. */
function walkPngs(directory, base = directory) {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walkPngs(path, base));
    } else if (entry.toLowerCase().endsWith(".png")) {
      found.push(relative(base, path).replaceAll("\\", "/"));
    }
  }
  return found;
}

/** Remove directories left empty after stale icons were pruned. */
function pruneEmptyDirectories(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (!statSync(path).isDirectory()) {
      continue;
    }
    pruneEmptyDirectories(path);
    if (readdirSync(path).length === 0) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

/** Write the catalog's name-to-path map into one theme manifest. */
function writeManifest(id, entries) {
  const path = join(ROOT, "src", "assets", "themes", id, "package.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.icons = Object.fromEntries(entries);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

const entries = catalog();
const paths = [...new Set(entries.map(([, path]) => path))];
for (const path of paths) {
  if (!(path in ICON_SOURCES)) {
    throw new Error(`No Lucide source registered for ${path}`);
  }
}

for (const theme of THEMES) {
  const iconRoot = join(ROOT, "src", "assets", "themes", theme.id, "icons");
  mkdirSync(iconRoot, { recursive: true });
  for (const path of paths) {
    const relativePath = path.replace(/^icons\//, "");
    if (relativePath.includes("/") || relativePath.includes("-")) {
      throw new Error(`Theme icons must be flat snake_case files: ${path}`);
    }
    const destination = join(iconRoot, relativePath);
    const png = await render(sourceSvg(ICON_SOURCES[path]), theme.ink, theme.stroke);
    writeFileSync(destination, png);
  }
  const expected = new Set(paths.map((path) => path.replace(/^icons\//, "")));
  for (const file of walkPngs(iconRoot)) {
    if (!expected.has(file)) {
      rmSync(join(iconRoot, file));
    }
  }
  pruneEmptyDirectories(iconRoot);
  writeManifest(theme.id, entries);
  console.log(JSON.stringify({ theme: theme.id, icons: paths.length, stroke: theme.stroke }));
}
