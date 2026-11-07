/**
 * Machine-checks the examples in `sdk/llm-guide.md` against the SDK types.
 *
 * The guide is the only contract a Code Cell client can read before writing a cell,
 * so its JavaScript and JSON examples must use real handle names, result
 * fields, and request shapes. This test extracts every fenced example, wraps
 * the JavaScript ones in a typed cell stub, and runs the repository's
 * TypeScript compiler over the generated files. It is intentionally a compile
 * check, not a prose check.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const GUIDE_PATH = join(ROOT, "sdk", "llm-guide.md");
const TSC_PATH = join(ROOT, "node_modules", "typescript", "bin", "tsc");
const CACHE_ROOT = join(ROOT, "node_modules", ".cache");

/** Return every fenced block for one language, in document order. */
function fencedBlocks(text, language) {
  const pattern = new RegExp("```" + language + "\\n([\\s\\S]*?)```", "g");
  return [...text.matchAll(pattern)].map((match, index) => ({
    index,
    body: match[1],
  }));
}

/**
 * The typed facade a cell actually receives. Picking handles and methods from
 * the SDK catches a renamed, removed, or profile-forbidden example API.
 */
const PRELUDE = `import type {
  ApiResult,
  ChartTransactionRequest,
  CodeCellRequest,
  CodeCellResult,
  ExtensionCapability,
  ReduxApi,
} from "@rpe-redux/extension-sdk";

type CellApi = {
  readonly version: string;
  capabilities(): Promise<readonly ExtensionCapability[]>;
  readonly document: Pick<
    ReduxApi["document"],
    "availability" | "state" | "snapshot" | "fingerprint"
  >;
  readonly chart: Pick<
    ReduxApi["chart"],
    | "availability"
    | "state"
    | "read"
    | "snapshot"
    | "metadata"
    | "resources"
    | "lines"
    | "line"
    | "parentId"
    | "notes"
    | "note"
    | "events"
    | "event"
  >;
  readonly selection: Pick<ReduxApi["selection"], "availability" | "state" | "subscribe">;
  readonly transaction: Pick<
    ReduxApi["transaction"],
    "availability" | "preview" | "apply" | "cancel" | "history"
  >;
  readonly library: Pick<
    ReduxApi["library"],
    | "availability"
    | "list"
    | "get"
    | "assets"
    | "asset"
    | "addAsset"
    | "removeAsset"
    | "revisions"
    | "revision"
  >;
};

declare const redux: CellApi;
declare const input: any;
declare const request: ChartTransactionRequest;
`;

/** Build one compilable module from a guide JavaScript block. */
function exampleSource(body) {
  const hasUnwrap = /\b(?:const|let|var|function)\s+unwrap\b/u.test(body);
  return [
    PRELUDE,
    hasUnwrap ? "" : "declare function unwrap<T>(result: ApiResult<T>): T;",
    "async function guideExample() {",
    body,
    "}",
    "void guideExample;",
    "",
  ].join("\n");
}

/** Build a type-checked module for one JSON example, or null when it is prose. */
function jsonExampleSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  if ("startRevisions" in value && "capabilities" in value) {
    return [
      'import type { CodeCellResult } from "@rpe-redux/extension-sdk";',
      `const result: CodeCellResult = ${JSON.stringify(value, null, 2)};`,
      "void result;",
      "",
    ].join("\n");
  }
  if ("source" in value && typeof value.source === "string") {
    return [
      'import type { CodeCellRequest } from "@rpe-redux/extension-sdk";',
      `const request: CodeCellRequest = ${JSON.stringify(value, null, 2)};`,
      "void request;",
      "",
    ].join("\n");
  }
  const transactionKeys = ["label", "metadata", "timing", "lines", "notes", "events"];
  if (transactionKeys.some((key) => key in value)) {
    // JSON can only carry strings, so widen the nominal ChartObjectId brand to
    // string while keeping every other field and shape from the real type.
    return [
      'import type { ChartObjectId, ChartTransactionRequest } from "@rpe-redux/extension-sdk";',
      "type JsonValue<T> = T extends ChartObjectId",
      "  ? string",
      "  : T extends readonly (infer U)[]",
      "    ? readonly JsonValue<U>[]",
      "    : T extends object",
      "      ? { [K in keyof T]: JsonValue<T[K]> }",
      "      : T;",
      "type JsonChartTransactionRequest = JsonValue<ChartTransactionRequest>;",
      `const request: JsonChartTransactionRequest = ${JSON.stringify(value, null, 2)};`,
      "void request;",
      "",
    ].join("\n");
  }
  return null;
}

test("sdk/llm-guide.md examples compile against the SDK type surface", () => {
  // A Windows checkout can carry CRLF line endings; the fence scanner expects
  // the newline right after the language tag, so normalize before parsing.
  const guide = readFileSync(GUIDE_PATH, "utf8").replace(/\r\n/g, "\n");
  const javascript = fencedBlocks(guide, "js");
  const json = fencedBlocks(guide, "json");
  assert.ok(javascript.length >= 6, "the guide must keep its runnable JavaScript examples");

  const sources = javascript.map((block) => exampleSource(block.body));
  for (const block of json) {
    let value;
    try {
      value = JSON.parse(block.body);
    } catch (error) {
      assert.fail(`guide JSON example ${block.index + 1} is not valid JSON: ${error.message}`);
    }
    const source = jsonExampleSource(value);
    if (source) {
      sources.push(source);
    }
  }

  mkdirSync(CACHE_ROOT, { recursive: true });
  const directory = mkdtempSync(join(CACHE_ROOT, "guide-examples-"));
  try {
    const repoRelative = relative(directory, ROOT).replaceAll("\\", "/") || ".";
    const repoPrefix = repoRelative.startsWith(".") ? repoRelative : `./${repoRelative}`;
    const files = sources.map((source, index) => {
      const name = `example-${index}.ts`;
      writeFileSync(join(directory, name), source, "utf8");
      return name;
    });
    const config = {
      compilerOptions: {
        target: "ES2023",
        lib: ["ES2023", "DOM", "DOM.Iterable"],
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noImplicitAny: false,
        noEmit: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
        types: [],
        paths: {
          "@rpe-redux/extension-sdk": [`./${repoPrefix}/sdk/index.d.ts`],
        },
      },
      files: [
        ...files.map((name) => `./${name}`),
        `./${repoPrefix}/sdk/index.d.ts`,
        `./${repoPrefix}/src/vite-env.d.ts`,
      ],
    };
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify(config, null, 2), "utf8");

    const result = spawnSync(
      process.execPath,
      [TSC_PATH, "-p", join(directory, "tsconfig.json"), "--pretty", "false"],
      { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
    );
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    assert.equal(
      result.status,
      0,
      `guide examples failed the SDK type check:\n${output || "(no compiler output)"}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime guide does not disclose internal implementation paths", () => {
  const guide = readFileSync(GUIDE_PATH, "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(guide, /(?:src\/(?:core|frontend|backend|src-tauri)|RestrictedCodeCellApi)/u);
});
