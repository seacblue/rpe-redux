import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cp, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readProductVersion } from "./scripts/productVersion.mjs";
import { normalizeRouteBase } from "./src/core/shell/route.ts";
import {
  bootSplashCopy,
  bootSplashMarkup,
  bootSplashStyle,
} from "./src/frontend/screens/startup/bootSplashMarkup.ts";

// The browser build has no host to ask for the product version, so the build
// bakes the validated desktop version in as a compile-time constant. The host
// must use the same version because it starts the matching sidecar.
const packageVersion = readProductVersion();

// Static assets use the deployment base; app destinations stay in the hash so
// the desktop host and GitHub Pages never need an SPA fallback.
const configuredWebBase = process.env.REDUX_WEB_BASE?.trim() || "/";
if (configuredWebBase.includes("://") || /[?#]/.test(configuredWebBase)) {
  throw new Error("REDUX_WEB_BASE must be a path, not an absolute URL or query");
}
const webBase = normalizeRouteBase(configuredWebBase);

/**
 * Browser-development settings injected by `scripts/dev.mjs`.
 *
 * The object carries the worktree's fixed ports and the sidecar's one-process
 * preference token. The development server writes it into the page before the
 * module graph runs; a production build never emits the bootstrap script.
 */
function readDevRuntime(): unknown {
  const raw = process.env.REDUX_DEV_RUNTIME;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Inject the browser-development settings into the served page only. */
function devRuntimeBootstrap() {
  const runtime = readDevRuntime();
  return {
    name: "redux-dev-runtime",
    apply: "serve" as const,
    transformIndexHtml(_html: string, context: { filename?: string }) {
      const filename = (context.filename ?? "").replaceAll("\\", "/");
      // The Extension sandbox is an opaque-origin iframe; it must never see the
      // host's preference credential.
      if (filename.endsWith("/extension-sandbox.html")) {
        return [];
      }
      if (!runtime) {
        return [];
      }
      return [
        {
          tag: "script",
          attrs: { "data-redux-dev-runtime": "" },
          children: `globalThis.__REDUX_DEV_RUNTIME__=${JSON.stringify(runtime).replaceAll("<", "\\u003c")};`,
          injectTo: "head-prepend" as const,
        },
      ];
    },
  };
}

// The browser paints before the runtime theme registry has applied a package.
// Generate that first-frame palette from the built-in dark package so the
// package stays the only place colour values are written by hand.
const bootstrapTheme = JSON.parse(
  readFileSync(new URL("./src/assets/themes/dark/package.json", import.meta.url), "utf8"),
) as { colors: Record<string, string> };

const bootstrapCss = `:root{${Object.entries(bootstrapTheme.colors)
  .map(([name, value]) => `${name}:${value};`)
  .join("")}color-scheme:dark;}`;

/**
 * Keep every application-graph chunk below the 500 kB warning threshold.
 *
 * Automatic splitting divides the startup graph into feature groups close to
 * this size, so a slow or cache-cold chunk does not hold the whole interface.
 * React and the rest of `node_modules` keep stable names, and the boot runtime
 * gets its own small group so the inline splash never pulls product code.
 */
const CHUNK_SIZE_LIMIT = 450_000;

/**
 * Stable feature group for one application module.
 *
 * The startup graph keeps only its own small modules. The editor shell, the
 * Extension pipeline, the host API, the media layer, and the settings UI are
 * grouped apart so their chunks can load after the startup screen is visible.
 */
function appChunkName(id: string): string | null {
  const path = id.replaceAll("\\", "/");
  if (path.includes("/node_modules/")) {
    return null;
  }
  if (
    path.includes("/src/frontend/screens/startup/bootSplash.ts") ||
    path.includes("/src/frontend/screens/startup/bootProgress.ts")
  ) {
    return null;
  }
  if (path.includes("/src/core/extensions/extensionStartupState.ts")) {
    return "app";
  }
  if (path.includes("/sdk/llm-guide.md")) {
    return "extension-hosts";
  }
  if (path.includes("/src/assets/skins/")) {
    return "editor-shell";
  }
  if (path.includes("/src/assets/extensions/")) {
    return "extension-loader";
  }
  if (path.includes("/src/frontend/platform/extensionPipeline.ts")) {
    return null;
  }
  if (
    path.includes("/src/frontend/platform/extensionLoader.ts") ||
    path.includes("/src/frontend/platform/extensionInstaller.ts") ||
    path.includes("/src/frontend/platform/extensionReview.ts") ||
    path.includes("/src/frontend/platform/extensionReconciliation.ts") ||
    path.includes("/src/frontend/platform/extensionTrust.ts")
  ) {
    return "extension-loader";
  }
  if (
    path.includes("/src/frontend/platform/extension") ||
    path.includes("/src/frontend/platform/ScriptUiHost.tsx") ||
    path.includes("/src/frontend/platform/codeCellBridge.ts")
  ) {
    return "extension-hosts";
  }
  if (path.includes("/src/frontend/platform/noteSkinBridge.ts")) {
    return "editor-shell";
  }
  if (
    path.includes("/src/frontend/platform/diagnosticLog.ts") ||
    path.includes("/src/frontend/platform/diagnosticCapture.ts")
  ) {
    return "app";
  }
  if (path.includes("/src/frontend/platform/")) {
    return "platform";
  }
  if (
    path.includes("/src/i18n/deferred.ts") ||
    /\/src\/i18n\/messages\/(?:en|zh)\/(?:settings|model|shortcuts|workspace|welcomeLibrary|welcomeReview|workspaceProgress|documentErrors|editor|editorPanels|timingDetection|settingsStepper|settingsLayout|layoutEditor|skinWorkbench|capabilities)\.ts$/u.test(
      path,
    )
  ) {
    return "deferred-catalogs";
  }
  if (path.includes("/src/core/api/")) {
    return "core-api";
  }
  if (path.includes("/src/core/codecell/")) {
    return "core-codecell";
  }
  if (path.includes("/src/core/extensions/")) {
    return "core-extensions";
  }
  if (path.includes("/src/core/settings/")) {
    return "core-settings";
  }
  if (path.includes("/src/core/edit/")) {
    return "core-edit";
  }
  if (path.includes("/src/core/global/chart/")) {
    return "core-chart";
  }
  if (path.includes("/src/core/global/document/")) {
    return "core-document";
  }
  if (path.includes("/src/core/media/")) {
    return "core-media";
  }
  if (path.includes("/src/core/io/")) {
    return "core-io";
  }
  if (path.includes("/src/core/migration/")) {
    return "core-migration";
  }
  if (path.includes("/src/core/runtime/")) {
    return "core-runtime";
  }
  if (path.includes("/src/core/platform/desktop/noteSkinPackages.ts")) {
    return "editor-shell";
  }
  if (path.includes("/src/core/")) {
    return "core";
  }
  if (path.includes("/src/design/components/")) {
    return "design-components";
  }
  if (path.includes("/src/design/controls/")) {
    return "design-controls";
  }
  if (path.includes("/src/design/patterns/")) {
    return "design-patterns";
  }
  if (path.includes("/src/design/")) {
    return "design";
  }
  if (path.includes("/src/frontend/screens/editor/")) {
    if (path.includes("/workspace/timeline/")) {
      return "editor-timeline";
    }
    if (path.includes("/workspace/preview/")) {
      return "editor-preview";
    }
    if (path.includes("/workspace/document/")) {
      return "editor-document";
    }
    if (path.includes("/workspace/runtime/")) {
      return "editor-runtime";
    }
    if (path.includes("/inspector/")) {
      return "editor-inspector";
    }
    if (path.includes("/canvas/")) {
      return "editor-canvas";
    }
    if (path.includes("/toolbar/")) {
      return "editor-toolbar";
    }
    if (path.includes("/workspace/")) {
      return "editor-workspace";
    }
    return "editor";
  }
  if (path.includes("/src/frontend/screens/settings/useSetting.ts")) {
    return "app";
  }
  if (path.includes("/src/frontend/screens/settings/")) {
    return "settings";
  }
  if (path.includes("/src/frontend/screens/welcome/")) {
    return "welcome";
  }
  if (path.includes("/src/frontend/screens/global/")) {
    return "global";
  }
  if (path.includes("/src/frontend/screens/startup/")) {
    return "startup";
  }
  if (path.includes("/src/frontend/chrome/topbar/windowControls/")) {
    return "app";
  }
  if (path.includes("/src/frontend/chrome/")) {
    return "chrome";
  }
  if (path.includes("/src/frontend/overlays/floatingHost.ts")) {
    return "app";
  }
  if (path.includes("/src/frontend/overlays/")) {
    return "overlays";
  }
  if (path.includes("/src/frontend/onboarding/")) {
    return "onboarding";
  }
  if (
    path.includes("/src/frontend/app/EditorShell.tsx") ||
    path.includes("/src/frontend/app/Shell.tsx") ||
    path.includes("/src/frontend/app/EditorBackdrop.tsx") ||
    path.includes("/src/frontend/app/routing/RouteRuntime.tsx")
  ) {
    return "editor-shell";
  }
  if (path.includes("/src/frontend/app/")) {
    return "app";
  }
  return "app";
}

function themeBootstrap() {
  return {
    name: "redux-theme-bootstrap",
    transformIndexHtml() {
      return [
        {
          tag: "style",
          attrs: { "data-theme-bootstrap": "" },
          children: bootstrapCss,
          injectTo: "head" as const,
        },
      ];
    },
  };
}

/**
 * Pin `document.baseURI` to the served asset root.
 *
 * Runtime asset helpers resolve against `document.baseURI`. One base tag keeps
 * every public asset at the deployment root while the visible route stays in
 * the hash.
 */
function documentBase() {
  return {
    name: "redux-document-base",
    transformIndexHtml() {
      return [
        {
          tag: "base",
          attrs: { href: webBase },
          injectTo: "head-prepend" as const,
        },
      ];
    },
  };
}

/** Attributes and meta names shared with the boot splash runtime. */
const BOOT_STYLE_ATTR = "data-redux-boot-style";
const BOOT_COPY_META = "redux-boot-copy";
const BOOT_ASSET_META = "redux-boot-assets";
const BOOT_STYLES_ATTR = "data-redux-boot-styles";

/** Escape one text or attribute value written into the generated page. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Read one double-quoted attribute from a generated tag. */
function tagAttribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "u"));
  return match?.[1] ?? null;
}

/** Resolve one built page URL to its file on disk. */
function builtAssetPath(url: string, outDir: string, base: string): string | null {
  try {
    const pathname = decodeURIComponent(new URL(url, `http://redux.local${base}`).pathname);
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    const relative = pathname.startsWith(normalizedBase)
      ? pathname.slice(normalizedBase.length)
      : pathname.replace(/^\/+/u, "");
    return join(outDir, relative);
  } catch {
    return null;
  }
}

/** Byte sizes of every script and stylesheet the built page requests. */
function bootAssetSizes(html: string, outDir: string, base: string): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/gu) ?? []) {
    const rel = tagAttribute(tag, "rel") ?? "";
    const isScript = tag.startsWith("<script") && tagAttribute(tag, "type") === "module";
    const isStylesheet = rel.split(/\s+/u).includes("stylesheet");
    const isPreload = /\b(?:modulepreload|preload)\b/u.test(rel);
    if (!isScript && !isStylesheet && !isPreload) {
      continue;
    }
    if (isPreload && !isStylesheet) {
      const as = tagAttribute(tag, "as");
      if (rel !== "modulepreload" && as !== "script" && as !== "style") {
        continue;
      }
    }
    const url = tagAttribute(tag, isScript ? "src" : "href");
    if (!url || Object.hasOwn(sizes, url)) {
      continue;
    }
    const file = builtAssetPath(url, outDir, base);
    if (!file) {
      continue;
    }
    try {
      sizes[url] = readFileSync(file).byteLength;
    } catch {
      // A page can name a host-provided asset that is not part of this bundle.
    }
  }
  return sizes;
}

/** Make the application stylesheet non-blocking for the inline splash. */
function deferBootStyles(html: string): string {
  return html.replace(/<link\b[^>]*>/gu, (tag) => {
    if (!/\brel="stylesheet"/u.test(tag) || tag.includes(BOOT_STYLES_ATTR)) {
      return tag;
    }
    let marked = /\bmedia="/u.test(tag)
      ? tag.replace(/\bmedia="[^"]*"/u, 'media="print"')
      : tag.replace(/\s*\/?>$/u, (end) => ` media="print"${end}`);
    if (!/\bfetchpriority="/u.test(marked)) {
      marked = marked.replace(/\s*\/?>$/u, (end) => ` fetchpriority="high"${end}`);
    }
    return marked.replace(/\s*\/?>$/u, (end) => ` ${BOOT_STYLES_ATTR}${end}`);
  });
}

/** Write the first-paint asset sizes into the meta tag the splash reads. */
function writeBootAssetSizes(html: string, sizes: Record<string, number>): string {
  const tag = `<meta name="${BOOT_ASSET_META}" content='${escapeHtml(JSON.stringify(sizes))}'>`;
  if (html.includes(`name="${BOOT_ASSET_META}"`)) {
    return html.replace(new RegExp(`<meta name="${BOOT_ASSET_META}"[^>]*>`, "u"), tag);
  }
  return html.replace("</head>", `    ${tag}\n  </head>`);
}

/** Insert the boot runtime tag ahead of the first module entry. */
function injectBootScript(html: string, scriptTag: string): string {
  if (html.includes(scriptTag)) {
    return html;
  }
  const firstModule = /<script\b[^>]*\btype="module"[^>]*><\/script>/u;
  if (firstModule.test(html)) {
    return html.replace(firstModule, (match) => `${scriptTag}\n    ${match}`);
  }
  return html.replace("</body>", `    ${scriptTag}\n  </body>`);
}

/**
 * Paint the startup card before the stylesheet and the module graph.
 *
 * Development serves the static card and its copy metadata; the boot runtime is
 * a separate module tag so it can execute before the application entry. The
 * production build records the byte size of every initial script, preloaded
 * chunk, and stylesheet, defers the one application stylesheet, and injects the
 * independently built boot entry so none of them can delay the first frame.
 */
function bootSplash(): Plugin {
  let outDir = resolve(process.cwd(), "dist");
  let base = "/";
  let command: "build" | "serve" = "build";
  let bootScriptUrl: string | null = null;
  let bootChunkSizes: Record<string, number> = {};
  return {
    name: "redux-boot-splash",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
      command = config.command;
    },
    transformIndexHtml(html, context) {
      const filename = (context.filename ?? "").replaceAll("\\", "/");
      if (!filename.endsWith("/index.html") && filename !== "index.html") {
        return html;
      }
      if (/\/(?:docs-site-dist|src\/public|release|dist|node_modules)\//u.test(filename)) {
        return html;
      }
      const copy = bootSplashCopy();
      let output = html.replace(
        /<title>[^<]*<\/title>/u,
        `<title>${escapeHtml(copy.en.appName)}</title>`,
      );
      if (!output.includes('class="redux-boot"')) {
        output = output.replace(
          /<div id="root"[^>]*><\/div>/u,
          (rootTag) => `${rootTag}\n    ${bootSplashMarkup(copy)}`,
        );
      }
      const copyMeta = `<meta name="${BOOT_COPY_META}" content='${escapeHtml(JSON.stringify(copy))}'>`;
      output = output.includes(`name="${BOOT_COPY_META}"`)
        ? output.replace(new RegExp(`<meta name="${BOOT_COPY_META}"[^>]*>`, "u"), copyMeta)
        : output.replace("</head>", `    ${copyMeta}\n  </head>`);
      if (command === "serve") {
        output = injectBootScript(
          output,
          '<script type="module" src="/src/frontend/screens/startup/bootSplashEntry.ts"></script>',
        );
      }
      return {
        html: output,
        tags: [
          {
            tag: "style",
            attrs: { [BOOT_STYLE_ATTR]: "" },
            children: bootSplashStyle(bootstrapTheme.colors),
            injectTo: "head" as const,
          },
        ],
      };
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type !== "chunk" ||
          !output.isEntry ||
          !output.facadeModuleId?.replaceAll("\\", "/").endsWith("/bootSplashEntry.ts")
        ) {
          continue;
        }
        bootScriptUrl = `${base}${output.fileName}`;
        const sizes: Record<string, number> = {};
        const visit = (fileName: string): void => {
          const imported = bundle[fileName];
          if (!imported || imported.type !== "chunk") {
            return;
          }
          const url = `${base}${imported.fileName}`;
          if (Object.hasOwn(sizes, url)) {
            return;
          }
          sizes[url] = Buffer.byteLength(imported.code, "utf8");
          for (const next of imported.imports) {
            visit(next);
          }
        };
        visit(output.fileName);
        bootChunkSizes = sizes;
        break;
      }
    },
    closeBundle() {
      if (command !== "build") {
        return;
      }
      const file = join(outDir, "index.html");
      if (!existsSync(file)) {
        return;
      }
      if (!bootScriptUrl) {
        throw new Error("The boot splash entry was not emitted by the build.");
      }
      const source = injectBootScript(
        readFileSync(file, "utf8"),
        `<script type="module" crossorigin src="${bootScriptUrl}"></script>`,
      );
      const sizes = { ...bootChunkSizes, ...bootAssetSizes(source, outDir, base) };
      writeFileSync(file, writeBootAssetSizes(deferBootStyles(source), sizes));
    },
  };
}

export default defineConfig({
  define: {
    __REDUX_VERSION__: JSON.stringify(packageVersion),
  },
  // The app's own runtime resources live under `src/public/`: Vite serves them from the site
  // root in dev and copies them verbatim into `dist/` on build, which is what keeps the
  // `assets/...` URLs (index.html, `assetUrl`, the deployed ZIP layout) working in both. It is
  // deliberately not `src/assets/`, which holds build-time external packages (note skins,
  // extensions) that are copied to their own top-level folders below.
  publicDir: "src/public",
  plugins: [
    react(),
    devRuntimeBootstrap(),
    themeBootstrap(),
    documentBase(),
    bootSplash(),
    {
      name: "redux-static-assets",
      async closeBundle() {
        await cp("LICENSE", "dist/LICENSE");
        await cp("src/assets/themes", "dist/themes", { recursive: true });
        await cp("src/assets/skins", "dist/skins", { recursive: true });
        // Note-skin packages ship as data for the app, not as repository docs.
        await rm("dist/skins/README.md", { force: true });
        await cp("src/assets/extensions", "dist/extensions", { recursive: true });
        // Keep static asset paths intact in hosted builds and portable archives.
        await writeFile("dist/.nojekyll", "");
      },
    },
  ],
  base: webBase,
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: Number(process.env.REDUX_FRONTEND_PORT ?? 4173),
    strictPort: true,
    // Native codegen emits HTML; watching it would reload an active editor.
    watch: {
      ignored: [
        "**/src-tauri/target/**",
        "**/dist/**",
        "**/release/**",
        "**/.local-tools/**",
        "**/docs/*.png",
      ],
    },
  },
  // Source maps are a debugging aid, not release payload. Debug desktop builds
  // set `REDUX_SOURCEMAP=1`; a release or plain web build skips the source-map
  // pass and the extra files.
  build: {
    target: "es2022",
    sourcemap: process.env.REDUX_SOURCEMAP === "1",
    rolldownOptions: {
      // The HTML merges every module script it contains into one entry. The boot
      // runtime has to stay independent so it can execute while the application
      // graph is still downloading; closeBundle injects its hashed tag.
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        bootSplash: fileURLToPath(
          new URL("./src/frontend/screens/startup/bootSplashEntry.ts", import.meta.url),
        ),
      },
      output: {
        // Fine-grained chunks can separate modules that initialize each other.
        // Rolldown wraps them so their source order survives the chunk split.
        strictExecutionOrder: true,
        codeSplitting: {
          // Keep dependencies with their feature group. Without this, the
          // semantic groups can form circular chunk imports at runtime.
          includeDependenciesRecursively: true,
          minSize: 20_000,
          maxSize: CHUNK_SIZE_LIMIT,
          groups: [
            {
              name: "boot-splash-runtime",
              test: /src[\\/]frontend[\\/]screens[\\/]startup[\\/](?:bootSplash|bootProgress)\.ts/,
              priority: 50,
              minSize: 0,
            },
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30,
            },
            {
              name: "vendor",
              test: /node_modules[\\/]/,
              priority: 20,
            },
            {
              name: "editor-shell",
              test: /src[\\/]frontend[\\/]app[\\/]EditorShell\.tsx$/,
              priority: 60,
              minSize: 0,
              includeDependenciesRecursively: false,
            },
            {
              name: "extension-pipeline",
              test: /src[\\/]frontend[\\/]platform[\\/]extensionPipeline\.ts$/,
              priority: 60,
              minSize: 0,
              includeDependenciesRecursively: false,
            },
            {
              name: appChunkName,
              debugName: "app",
              priority: 10,
              minSize: 20_000,
              maxSize: CHUNK_SIZE_LIMIT,
            },
          ],
        },
      },
    },
  },
});
