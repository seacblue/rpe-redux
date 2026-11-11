/**
 * Style contracts that the compiler and ESLint cannot see.
 *
 * `!important` hides cascade ownership and makes later component rules fight
 * the stylesheet that happened to win. The repository keeps the cascade
 * explicit through ownership, source order, and component specificity.
 *
 * Typography is role-based: `src/design/styles/tokens.less` owns every CSS px
 * size. A feature sheet names the role its text plays, so a local 9/10/11/12
 * ladder cannot reappear. Text glyphs use the `--glyph-size-*` tokens. Canvas
 * text resolves the same roles through `src/frontend/screens/editor/canvas/text.ts`; a raw
 * font stack outside that helper is rejected too.
 *
 * The same rule covers surface styling: colours come from the active theme,
 * font families from `--font-*`, surface radii from `--radius-*` /
 * `--design-radius-*`, and the common spacing steps from `--space-*`. The
 * colour picker's hue model is the single documented raw-colour exception.
 *
 * Design sheets name one of three edge roles — `--edge-control`,
 * `--edge-divider`, or `--edge-emphasis` — instead of a legacy hairline token.
 * The same rule now covers the business layer: only the token sheet and theme
 * packages still read the legacy names.
 *
 * Frontend actions come from the design system too. A raw `<button>` in
 * `src/frontend/` bypasses the shared variants, pressed states, focus ring, and
 * tooltip contract, so it is rejected in favour of `Button` or `IconButton`.
 *
 * Floating surfaces paint on the ordered `--z-*` ladder in
 * `src/design/styles/tokens.less`. A component names a rung, or offsets it by a
 * few steps for its own children; it never writes an absolute number. The only
 * numeric z-index a component may carry is the -1…9 ordinal for siblings inside
 * its own stacking context, because that number never leaves the parent box.
 * This gate also rejects `--z-*` names the ladder does not define, rung
 * definitions outside the token sheet, and inline `zIndex` styles.
 * Product styles use semantic classes; DOM ids remain available for automation
 * and accessibility contracts but never own a stylesheet rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tokenSheet = "src/design/styles/tokens.less";
const canvasFontModule = "src/frontend/screens/editor/canvas/text.ts";
const inspectorFieldRhythmSheet = "src/frontend/screens/editor/inspector/inspectorDesign.less";
const importantFailures = [];
const typeFailures = [];
const canvasFailures = [];
const colorFailures = [];
const fontFailures = [];
const radiusFailures = [];
const spacingFailures = [];
const rawButtonFailures = [];
const fieldRhythmFailures = [];
const zIndexFailures = [];
const cssIdSelectorFailures = [];
const edgeRoleFailures = [];
const usedZIndexTokens = new Set();
const definedZIndexTokens = new Set();
const allowedSize = /^var\(--(?:type|glyph-size)-[a-z0-9-]+\)$/u;
const rawCanvasFont = /Saira,\s*['"]Source Han Sans CN['"]/u;
const rawColor = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/u;
const namedColorDeclaration =
  /(?:^|[;{])\s*(?:color|background|background-color|border|border-color|outline|fill|stroke|box-shadow|text-shadow)\s*:\s*[^;{}]*\b(?:white|black|red|blue|green|yellow|orange|gray|grey)\b/iu;
const fontDeclaration = /font-family\s*:\s*([^;]+);/u;
const radiusDeclaration = /border-radius\s*:\s*([^;]+);/u;
const spacingDeclaration =
  /^\s*(?:padding|margin|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;]+);/u;
const spacingStep = /\b(?:4|6|8|10|12|16|20|24|32)px\b/u;
const zIndexDeclaration = /\bz-index\s*:\s*([^;]+);/u;
const zIndexTokenDefinition = /--z-[a-z0-9-]+\s*:\s*([^;]+);/u;
const zIndexTokenUsage = /--z-[a-z0-9-]+/gu;
// One rung (`Z`), that rung plus local child offsets (`1`) or the modal stack's
// published layer (`L`), or a local sibling ordinal in -1…9.
const allowedZIndexDeclaration = /^(?:Z|calc\(Z(?:\s*[+-]\s*(?:\d+|L))+\)|-1|[0-9])$/u;
const allowedZIndexTokenValue = /^(?:\d+|calc\(Z(?:\s*[+-]\s*\d+)+\))$/u;
const zIndexTokenMax = 2000;
// Design sheets name a role, not a legacy hairline token. The business layer
// still reads the legacy names until its own sheets migrate.
const legacyEdgeToken =
  /var\(--(?:panel-border|border-subtle|border-strong|outline|input-border)\)/u;

/** Drop same-line Less comments so declarations inside them are ignored. */
function stripComments(line) {
  return line.replace(/\/\/.*$/u, "").replace(/\/\*.*?\*\//gu, "");
}

/** Reduce a z-index value to the ladder vocabulary the gate reasons about. */
function normalizeZIndexValue(value) {
  return value
    .replace(/var\(--z-[a-z0-9-]+\)/gu, "Z")
    .replace(/var\(--modal-(?:stack|scrim)-layer,\s*0\)/gu, "L")
    .trim();
}
// The colour picker draws the colour model itself, not a theme surface. The
// colour field computes a contrast ink and normalizes the value the browser's
// colour input requires; neither is a themed surface colour.
const colorExceptionSheets = new Set(["src/design/controls/controls.less"]);
const colorDataModules = new Set(["src/design/components/input/colorModel.ts"]);

/** Collect violations from every source file below a directory. */
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      visit(path);
      continue;
    }
    const extension = extname(entry.name);
    if (![".less", ".css", ".ts", ".tsx"].includes(extension)) {
      continue;
    }
    const relativePath = relative(root, path).split(sep).join("/");
    const content = readFileSync(path, "utf8");
    if (extension === ".less" || extension === ".css") {
      content.split(/\r?\n/u).forEach((line, index) => {
        const location = `${relativePath}:${index + 1}`;
        if (line.includes("!important")) {
          importantFailures.push(`${location}: ${line.trim()}`);
        }
        if (
          (relativePath.startsWith("src/design/") || relativePath.startsWith("src/frontend/")) &&
          relativePath !== tokenSheet
        ) {
          if (legacyEdgeToken.test(stripComments(line))) {
            edgeRoleFailures.push(
              `${location}: ${line.trim()} (use --edge-control, --edge-divider, or --edge-emphasis)`,
            );
          }
        }
        if (relativePath === tokenSheet) {
          const code = stripComments(line);
          const definition = code.match(zIndexTokenDefinition);
          if (definition) {
            const value = definition[1].trim();
            const name = definition[0].slice(0, definition[0].indexOf(":")).trim();
            definedZIndexTokens.add(name);
            if (!allowedZIndexTokenValue.test(normalizeZIndexValue(value))) {
              zIndexFailures.push(
                `${location}: ${line.trim()} (a rung is an integer or a rung offset)`,
              );
            } else if (/^\d+$/u.test(value) && Number(value) > zIndexTokenMax) {
              zIndexFailures.push(
                `${location}: ${line.trim()} (rung above ${zIndexTokenMax}; keep the ladder compact)`,
              );
            }
          }
          return;
        }
        const size = line.match(/font-size\s*:\s*([^;]+);/u);
        if (size) {
          const value = size[1].trim();
          if (!["inherit", "0"].includes(value) && !allowedSize.test(value)) {
            typeFailures.push(`${location}: ${line.trim()}`);
          }
        }
        const code = stripComments(line);
        for (const match of code.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/gu)) {
          if (!/^[0-9a-fA-F]{3,8}$/u.test(match[1])) {
            cssIdSelectorFailures.push(`${location}: ${line.trim()}`);
            break;
          }
        }
        if (!colorExceptionSheets.has(relativePath)) {
          if (rawColor.test(code) || namedColorDeclaration.test(code)) {
            colorFailures.push(`${location}: ${line.trim()}`);
          }
        }
        const font = code.match(fontDeclaration);
        if (font && !/^\s*(?:inherit|var\(--font-)/u.test(font[1])) {
          fontFailures.push(`${location}: ${line.trim()}`);
        }
        const radius = code.match(radiusDeclaration);
        if (
          radius &&
          /(?:^|\s)\d+px/u.test(radius[1]) &&
          !/var\(--(?:radius|design-radius)/u.test(radius[1]) &&
          !/\b999px\b/u.test(radius[1])
        ) {
          radiusFailures.push(`${location}: ${line.trim()}`);
        }
        const spacing = code.match(spacingDeclaration);
        if (spacing && !/clamp\(|min\(|max\(/u.test(spacing[1]) && spacingStep.test(spacing[1])) {
          spacingFailures.push(`${location}: ${line.trim()}`);
        }
        const zIndex = code.match(zIndexDeclaration);
        if (zIndex) {
          const value = zIndex[1].trim();
          if (!allowedZIndexDeclaration.test(normalizeZIndexValue(value))) {
            zIndexFailures.push(
              `${location}: ${line.trim()} (name a --z-* rung, or use a local -1…9 ordinal)`,
            );
          }
          for (const name of value.match(zIndexTokenUsage) ?? []) {
            usedZIndexTokens.add(name);
          }
        }
        if (zIndexTokenDefinition.test(code)) {
          zIndexFailures.push(
            `${location}: ${line.trim()} (z-index rungs are defined in ${tokenSheet})`,
          );
        }
      });
      if (relativePath !== tokenSheet && /\bfont\s*:[^;{}]*\d+px/u.test(content)) {
        typeFailures.push(`${relativePath}: raw px size in a font shorthand`);
      }
      continue;
    }
    if (
      relativePath !== canvasFontModule &&
      relativePath.startsWith("src/frontend/") &&
      !relativePath.startsWith("src/frontend/screens/editor/workspace/preview/")
    ) {
      content.split(/\r?\n/u).forEach((line, index) => {
        if (rawCanvasFont.test(line)) {
          canvasFailures.push(
            `${relativePath}:${index + 1}: raw canvas font stack (use canvasFont or CANVAS_FONT_FAMILY)`,
          );
        }
      });
    }
    if (extension === ".tsx" && relativePath.startsWith("src/frontend/")) {
      content.split(/\r?\n/u).forEach((line, index) => {
        if (/<button\b/u.test(line)) {
          rawButtonFailures.push(
            `${relativePath}:${index + 1}: raw button (use Button or IconButton)`,
          );
        }
      });
    }
    if (extension === ".ts" || extension === ".tsx") {
      content.split(/\r?\n/u).forEach((line, index) => {
        if (/\bzIndex\s*:/u.test(stripComments(line))) {
          zIndexFailures.push(
            `${relativePath}:${index + 1}: inline zIndex (put the rank on a stylesheet rule instead)`,
          );
        }
      });
    }
    if (
      relativePath.startsWith("src/frontend/") &&
      relativePath !== inspectorFieldRhythmSheet &&
      /--field-row-(?:padding|gap|min-height|margin)(?:-[a-z]+)?\s*:/u.test(content)
    ) {
      fieldRhythmFailures.push(`${relativePath}: field-row geometry belongs to the inspector`);
    }
    if (relativePath.startsWith("src/design/") && !colorDataModules.has(relativePath)) {
      content.split(/\r?\n/u).forEach((line, index) => {
        const code = line.replace(/\/\/.*$/u, "").replace(/\/\*.*?\*\//gu, "");
        if (rawColor.test(code)) {
          colorFailures.push(
            `${relativePath}:${index + 1}: raw colour in a design primitive (read a theme token)`,
          );
        }
      });
    }
  }
}

visit(join(root, "src"));

if (importantFailures.length) {
  console.error("Forbidden !important declarations:\n" + importantFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: no !important declarations");
}

if (typeFailures.length) {
  console.error("Forbidden raw font sizes (use a typography role):\n" + typeFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: typography uses role tokens");
}

if (canvasFailures.length) {
  console.error("Forbidden raw canvas font stacks:\n" + canvasFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: canvas text uses role helpers");
}

if (colorFailures.length) {
  console.error("Forbidden raw colours (use a theme token):\n" + colorFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: colours use theme tokens");
}

if (fontFailures.length) {
  console.error(
    "Forbidden raw font families (use --font-mono or inherit):\n" + fontFailures.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("PASS style rules: font families use tokens");
}

if (radiusFailures.length) {
  console.error("Forbidden raw surface radii (use a radius token):\n" + radiusFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: surface radii use tokens");
}

if (spacingFailures.length) {
  console.error(
    "Forbidden raw spacing steps (use a spacing token):\n" + spacingFailures.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("PASS style rules: spacing uses tokens");
}

if (edgeRoleFailures.length) {
  console.error(
    "Design sheets must name an edge role (control, divider, emphasis):\n" +
      edgeRoleFailures.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("PASS style rules: edges use the three role tokens");
}

if (rawButtonFailures.length) {
  console.error("Frontend buttons must use the design system:\n" + rawButtonFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: frontend actions use design buttons");
}

if (fieldRhythmFailures.length) {
  console.error(
    "Field-row geometry is owned by the inspector, not a feature sheet:\n" +
      fieldRhythmFailures.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("PASS style rules: inspector owns field-row geometry");
}

if (zIndexFailures.length) {
  console.error("z-index must use the shared ladder:\n" + zIndexFailures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("PASS style rules: z-index uses the shared ladder");
}

if (cssIdSelectorFailures.length) {
  console.error(
    "CSS ID selectors are forbidden (use a semantic class; keep ids only for automation/accessibility):\n" +
      cssIdSelectorFailures.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("PASS style rules: no CSS ID selectors");
}

const undefinedZIndexTokens = [...usedZIndexTokens].filter(
  (name) => !definedZIndexTokens.has(name),
);
if (undefinedZIndexTokens.length) {
  console.error(
    `Undefined z-index rungs (define them in ${tokenSheet}):\n` + undefinedZIndexTokens.join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log("PASS style rules: every z-index rung is defined in the ladder");
}
