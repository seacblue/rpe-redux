/** The compile-time deprecation extractor and usage scanner. */
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  extractDeprecations,
  renderGenerated,
  scanDeprecatedUsage,
} from "../../../scripts/checkDeprecations.mjs";

const ROOT = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const CHART_FILE = join(ROOT, "src", "core", "api", "chart.ts");
const FIXTURE_FILE = join(ROOT, "src", "test", "dev", "fixture.ts");
const DEPRECATIONS = new Map([
  ["chart.notes", 'Use `readAll("notes")`.'],
  ["chart.events", 'Use `readAll("events")`.'],
]);
const OWNERS = new Map([[`${CHART_FILE}:chart`, "chart"]]);

test("JSDoc @deprecated is extracted from facade members and nested namespaces", () => {
  const source = `export const demo = Object.freeze({
    /**
     * @deprecated Use fresh().
     */
    old() {
      return 1;
    },
    nested: Object.freeze({
      /** @deprecated Nested replacement. */
      gone: 1,
    }),
  });
  `;
  assert.deepEqual(extractDeprecations(source, "demo.ts"), [
    { path: "demo.old", message: "Use fresh()." },
    { path: "demo.nested.gone", message: "Nested replacement." },
  ]);
});

test("the generated registry is sorted and JSON-escaped", () => {
  const text = renderGenerated(
    new Map([
      ["chart.notes", 'Use `readAll("notes")`.'],
      ["chart.events", 'Use `readAll("events")`.'],
    ]),
  );
  assert.match(text, /export const DEPRECATED_API/u);
  assert.ok(text.indexOf('"chart.events"') < text.indexOf('"chart.notes"'));
  assert.match(text, /readAll\("notes"\)/u);
});

test("named imports and aliases report the deprecated member path", () => {
  const direct = `import { chart } from "../../core/api/chart.ts";
chart.notes();
`;
  const [finding] = scanDeprecatedUsage(direct, FIXTURE_FILE, DEPRECATIONS, OWNERS);
  assert.equal(finding.path, "chart.notes");
  assert.equal(finding.line, 2);

  const aliased = `import { chart as c } from "../../core/api/chart.ts";
c.events();
`;
  const [aliasFinding] = scanDeprecatedUsage(aliased, FIXTURE_FILE, DEPRECATIONS, OWNERS);
  assert.equal(aliasFinding.path, "chart.events");
});

test("deprecated-allow opts one line out of the scan", () => {
  const source = `import { chart } from "../../core/api/chart.ts";
chart.notes(); // deprecated-allow: compatibility test
`;
  assert.deepEqual(scanDeprecatedUsage(source, FIXTURE_FILE, DEPRECATIONS, OWNERS), []);
});
