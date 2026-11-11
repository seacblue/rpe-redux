import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { readProductVersion } from "./scripts/productVersion.mjs";
import { normalizeRouteBase } from "./src/core/shell/route.ts";

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
 * Split the application shell from the large editor and design systems so the
 * startup chunk does not have to parse every product surface before the first
 * frame. Every group is a static import of the entry, so load order is unchanged.
 */
function manualChunk(id: string): string | undefined {
  const path = id.replaceAll("\\", "/");
  if (path.includes("/node_modules/")) {
    if (/\/node_modules\/(?:react|react-dom|scheduler)\//.test(path)) {
      return "react";
    }
    return "vendor";
  }
  if (path.includes("/src/design/")) {
    return "design";
  }
  if (
    path.includes("/src/frontend/screens/editor/") ||
    path.includes("/src/core/edit/") ||
    path.includes("/src/core/global/chart/")
  ) {
    return "editor";
  }
  return undefined;
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
      output: {
        manualChunks: manualChunk,
      },
    },
  },
});
