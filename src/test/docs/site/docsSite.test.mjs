/**
 * Tests for the Extension SDK documentation site.
 *
 * Covers the Markdown subset, HTML escaping, link handling, index integrity,
 * generated content, and one real CLI build.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  assertSafeHref,
  buildDocsSite,
  renderMarkdown,
} from "../../../../scripts/buildDocsSite.mjs";
import { EXTENSION_CAPABILITIES } from "../../../core/extensions/capabilities.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const DOCS = join(ROOT, "docs-sdk");

/** Read one JSON file from the repository. */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Return the HTML between one level-two heading and the next one. */
function sectionHtml(html, id) {
  const marker = `<h2 id="${id}">`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `missing ${id} section`);
  const contentStart = html.indexOf("</h2>", start) + "</h2>".length;
  const next = html.indexOf("<h2 ", contentStart);
  return html.slice(contentStart, next === -1 ? undefined : next);
}

/** Decode the entities the renderer emits inside code blocks. */
function decodeCode(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

/** Remove the highlighter's span markup without touching escaped code text. */
function stripTokens(html) {
  return html.replace(/<\/?span[^>]*>/gu, "");
}

/** Read the first fenced code block of one rendered section. */
function sectionCode(html, id) {
  const section = sectionHtml(html, id);
  const start = section.indexOf("<pre><code");
  assert.ok(start >= 0, `missing ${id} code block`);
  const contentStart = section.indexOf(">", section.indexOf("<code", start)) + 1;
  const end = section.indexOf("</code></pre>", contentStart);
  assert.ok(end >= 0, `unterminated ${id} code block`);
  return decodeCode(stripTokens(section.slice(contentStart, end)));
}

/** The parameter names listed by one method page's parameter table. */
function tableParameterNames(html) {
  const section = sectionHtml(html, "参数");
  return [...section.matchAll(/<tr><td><code>([^<]+)<\/code><\/td>/g)].map((match) => match[1]);
}

/** Split a call argument list at top-level commas. */
function splitArguments(source) {
  const trimmed = source.trim();
  if (!trimmed) {
    return [];
  }
  const args = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  args.push(source.slice(start).trim());
  return args;
}

/** Extract the arguments of the example's awaited API call. */
function exampleArguments(code) {
  const marker = /await\s+[\w.]+\(/.exec(code);
  assert.ok(marker, "example has no awaited API call");
  const open = marker.index + marker[0].length - 1;
  let depth = 0;
  let quote = "";
  for (let index = open; index < code.length; index += 1) {
    const char = code[index];
    if (quote) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return splitArguments(code.slice(open + 1, index));
      }
    }
  }
  assert.fail("unterminated example call");
}

test("renderer escapes raw HTML", () => {
  const result = renderMarkdown("# Title\n\n<script>alert(1)</script>\n\nA <b>bold</b> & text.");
  assert.match(result.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(result.html.toLowerCase().includes("<script>"), false);
  assert.match(result.html, /&lt;b&gt;bold&lt;\/b&gt; &amp; text/);
  assert.equal(result.title, "Title");
});

test("renderer builds a pipe table with escaped cells", () => {
  const result = renderMarkdown("# Table\n\n| Name | Value |\n| --- | --- |\n| alpha | <x> |\n");
  assert.match(result.html, /<table><thead><tr><th>Name<\/th><th>Value<\/th><\/tr><\/thead>/);
  assert.match(result.html, /<td>alpha<\/td><td>&lt;x&gt;<\/td>/);
});

test("renderer escapes fenced code and keeps the language", () => {
  const result = renderMarkdown('# Code\n\n```js\nconst x = "<tag>";\n```\n');
  assert.match(result.html, /<pre><code class="language-js">/);
  const [, code] = /<pre><code class="language-js">([\s\S]*?)<\/code><\/pre>/u.exec(result.html);
  assert.match(stripTokens(code), /const x = &quot;&lt;tag&gt;&quot;;/);
  assert.doesNotMatch(result.html, /<tag>/);
  assert.equal(decodeCode(stripTokens(code)), 'const x = "<tag>";');
});

test("highlighter emits stable tokens and keeps code text searchable", () => {
  const source = [
    "# Tokens",
    "",
    "```js",
    "// 读取当前主题",
    'const label = call("<tag>", 42, true);',
    "const { api } = context;",
    "```",
    "",
    "```json",
    '{ "name": "RPE", "count": 2, "enabled": false }',
    "```",
    "",
    "```text",
    "RPE Redux <SDK> & docs",
    "```",
    "",
  ].join("\n");
  const result = renderMarkdown(source);
  const blocks = [
    ...result.html.matchAll(/<pre><code class="language-([a-z]+)">([\s\S]*?)<\/code><\/pre>/gu),
  ];
  assert.equal(blocks.length, 3);

  const script = blocks[0][2];
  for (const kind of ["comment", "keyword", "string", "number", "literal", "function"]) {
    assert.match(script, new RegExp(`<span class="tok-${kind}">`), kind);
  }
  assert.match(script, /<span class="tok-string">&quot;&lt;tag&gt;&quot;<\/span>/);
  assert.doesNotMatch(result.html, /<tag>/);
  assert.equal(
    decodeCode(stripTokens(script)),
    '// 读取当前主题\nconst label = call("<tag>", 42, true);\nconst { api } = context;',
  );

  const json = blocks[1][2];
  assert.match(json, /<span class="tok-property">&quot;name&quot;<\/span>/);
  assert.match(json, /<span class="tok-string">&quot;RPE&quot;<\/span>/);
  assert.match(json, /<span class="tok-number">2<\/span>/);
  assert.match(json, /<span class="tok-literal">false<\/span>/);

  const text = blocks[2][2];
  assert.equal(text, "RPE Redux &lt;SDK&gt; &amp; docs");
  assert.doesNotMatch(text, /<span/);

  // Token markup must not leak extra spaces into the search text.
  assert.match(result.text, /const label = call\("<tag>", 42, true\);/);
  assert.match(result.text, /RPE Redux <SDK> & docs/);
});

test("inline code is protected from emphasis", () => {
  const result = renderMarkdown("# Inline\n\nUse `**not bold**` here.");
  assert.match(result.html, /<code>\*\*not bold\*\*<\/code>/);
  assert.doesNotMatch(result.html, /<strong>not bold<\/strong>/);
});

test("internal links resolve through the build callback", () => {
  const result = renderMarkdown("# Link\n\n[Next](next.md#hello-world)", {
    pageSlug: "current",
    fromFile: "current.md",
    resolveLink(href) {
      return {
        href: "#/page/next#hello-world",
        internal: true,
        targetSlug: "next",
        targetRoute: "next",
        anchor: href.split("#")[1] ?? "",
      };
    },
  });
  assert.match(result.html, /href="#\/page\/next#hello-world"/);
  assert.match(result.html, /data-route="next" data-anchor="hello-world"/);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].targetSlug, "next");
  assert.equal(result.links[0].anchor, "hello-world");
});

test("unsafe and unresolved links fail", () => {
  assert.throws(() => assertSafeHref("javascript:alert(1)"), /forbidden target/);
  assert.throws(() => assertSafeHref("data:text/html,x"), /forbidden target/);
  assert.throws(() => renderMarkdown("[X](javascript:alert(1))"), /forbidden target/);
  assert.throws(() => renderMarkdown("[X](missing.md)"), /no resolver/);
});

test("duplicate headings receive unique anchor ids", () => {
  const result = renderMarkdown("# Root\n\n## Same\n\n## Same\n");
  const ids = result.headings.map((heading) => heading.id);
  assert.deepEqual(ids, ["root", "same", "same-2"]);
});

test("index.json references every markdown page exactly once", async () => {
  const index = await readJson(join(DOCS, "index.json"));
  const localeFiles = async (locale) =>
    (await readdir(join(DOCS, locale), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `${locale}/${entry.name}`);
  const files = await localeFiles("zh");
  const englishFiles = await localeFiles("en");
  const referenced = new Set();
  const slugs = new Set();
  for (const section of index.sections) {
    for (const page of section.pages) {
      assert.match(page.slug, /^[a-z0-9][a-z0-9-]*$/);
      assert.ok(!slugs.has(page.slug), `duplicate slug ${page.slug}`);
      slugs.add(page.slug);
      const file = page.file ?? `${page.slug}.md`;
      referenced.add(file);
      await stat(join(DOCS, file));
    }
  }
  assert.deepEqual([...referenced].sort(), [...files].sort());
  const locales = await readJson(join(DOCS, "locales.json"));
  const englishReferenced = Object.values(locales.locales.en.pages).map((page) => page.file);
  assert.deepEqual(englishReferenced.sort(), englishFiles.sort());
});

test("build writes the shell, content index, and search fields", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "rpe-docs-"));
  try {
    const summary = await buildDocsSite({ outDir });
    assert.ok(summary.pages >= 11);
    assert.ok(summary.methods > 100);
    assert.equal(summary.capabilities, EXTENSION_CAPABILITIES.length);

    for (const file of [
      "index.html",
      "content.json",
      "assets/app.js",
      "assets/app.css",
      "assets/brand.png",
    ]) {
      const info = await stat(join(outDir, file));
      assert.ok(info.size > 0, file);
    }

    const content = await readJson(join(outDir, "content.json"));
    const pages = content.sections.flatMap((section) => section.pages);
    assert.equal(pages.length, summary.pages);
    assert.equal(content.defaultLocale, "zh");
    assert.ok(content.locales?.zh);
    assert.ok(content.locales?.en);
    assert.equal(content.locales.en.htmlLang, "en");
    const englishPages = content.locales.en.sections.flatMap((section) => section.pages);
    assert.equal(englishPages.length, pages.length);
    assert.doesNotMatch(
      englishPages.map((page) => `${page.title}\n${page.text}`).join("\n"),
      /[\u4e00-\u9fff]/u,
      "English locale contains no Han characters",
    );
    for (const page of pages) {
      assert.ok(page.html.length > 0, page.slug);
      assert.ok(page.text.length > 0, page.slug);
      assert.ok(Array.isArray(page.keywords), page.slug);
      assert.ok(page.route, page.slug);
    }
    const hooksPage = pages.find((page) => page.route === "hooks");
    assert.ok(hooksPage, "hooks page is generated");
    assert.match(hooksPage.html, /context\.hooks\.register/);
    assert.match(hooksPage.html, /context\.hooks\.invoke/);
    assert.match(hooksPage.html, /data-route="context"/);

    const nav = content.nav;
    assert.ok(Array.isArray(nav), "content.json carries the navigation tree");

    const navRoutes = [];
    const navIds = new Set();
    const visitNav = (nodes) => {
      for (const node of nodes ?? []) {
        assert.ok(!navIds.has(node.id), `duplicate nav id ${node.id}`);
        navIds.add(node.id);
        assert.equal(typeof node.defaultExpanded, "boolean", node.id);
        if (node.route) {
          navRoutes.push(node.route);
        }
        visitNav(node.children);
      }
    };
    visitNav(nav);
    assert.deepEqual(
      [...navRoutes].sort(),
      pages.map((page) => page.route).sort(),
      "every page appears once in the navigation tree",
    );
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("generated API syntax lines use positional parameters", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "rpe-docs-"));
  try {
    await buildDocsSite({ outDir });
    const content = await readJson(join(outDir, "content.json"));
    const pages = content.sections.flatMap((section) => section.pages);
    const byRoute = new Map(pages.map((page) => [page.route, page]));
    const expected = new Map([
      ["api/sidebar/open", "context.api.sidebar.open(id)"],
      ["api/sidebar/close", "context.api.sidebar.close(id)"],
      ["api/values/byId.set", "context.api.values.byId.set(id, value)"],
      ["api/transaction/apply", "context.api.transaction.apply(request)"],
      ["api/toolbar/register", "context.api.toolbar.register(entry)"],
      ["api/theme/tokens", "context.api.theme.tokens()"],
    ]);

    for (const [route, call] of expected) {
      const page = byRoute.get(route);
      assert.ok(page, route);
      const syntax = sectionCode(page.html, "语法").split("\n")[0];
      assert.equal(syntax, call, route);
      assert.doesNotMatch(syntax, /\(\{ /, `${route} wraps a parameter`);
    }

    // Example blocks render their argument values from the same ordered parameter
    // list as the syntax line, so the table names and the example arity pin both
    // representations to that one source.
    for (const page of pages) {
      if (page.kind !== "method") {
        continue;
      }
      const syntax = sectionCode(page.html, "语法").split("\n")[0];
      assert.doesNotMatch(syntax, /\(\{ /, `${page.route} wraps a parameter`);
      const syntaxArgs = splitArguments(
        syntax.slice(syntax.indexOf("(") + 1, syntax.lastIndexOf(")")),
      );
      assert.deepEqual(syntaxArgs, tableParameterNames(page.html), `${page.route} syntax names`);
      const exampleArgs = exampleArguments(sectionCode(page.html, "示例"));
      assert.equal(exampleArgs.length, syntaxArgs.length, `${page.route} example arity`);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("real CLI build exits zero", { timeout: 120000 }, () => {
  const result = spawnSync(process.execPath, ["scripts/buildDocsSite.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Built \d+ pages/);
});
