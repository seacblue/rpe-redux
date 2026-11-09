import js from "@eslint/js";
import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

/**
 * Flat ESLint config.
 *
 * TypeScript 7 (the native compiler this project pins) no longer exposes the
 * classic compiler API, so typescript-eslint cannot parse these files. TSX is
 * parsed with @babel/eslint-parser instead and type correctness stays the job of
 * the TypeScript compiler (`tsc --noEmit`).
 */
/**
 * The names that reach the host, and the selectors that find them.
 *
 * Ticket 50: a bare-identifier rule cannot see `new Audio()`, `new Image()`,
 * `createImageBitmap()`, `URL.createObjectURL()` or `globalThis.innerWidth`, so
 * `core/media` reached the host for a whole refactor without the guard noticing.
 * `core/platform/**` is the one place under `src/core/` allowed to say these —
 * that is what a platform seam is — and `core/api/index.ts` installs the plugin
 * facade on `window`.
 */
const hostAccessSyntax = [
  {
    selector: "NewExpression[callee.name='Audio']",
    message:
      "`core/` must not construct host media objects; go through `core/platform/browser/mediaHost.ts`.",
  },
  {
    selector: "NewExpression[callee.name='Image']",
    message:
      "`core/` must not construct host image objects; go through `core/platform/browser/mediaHost.ts`.",
  },
  {
    selector: "CallExpression[callee.name='createImageBitmap']",
    message:
      "`core/` must not decode bitmaps itself; go through `core/platform/browser/mediaHost.ts`.",
  },
  {
    selector: "MemberExpression[object.name='URL'][property.name=/^(create|revoke)ObjectURL$/]",
    message:
      "`core/` must not manage blob URLs itself; go through `core/platform/browser/mediaHost.ts`.",
  },
  {
    selector:
      "MemberExpression[object.name='globalThis'][property.name=/^(innerWidth|innerHeight|devicePixelRatio)$/]",
    message:
      "`core/` must not read the host viewport; go through `core/platform/browser/mediaHost.ts`.",
  },
];

const hostAccessGlobals = [
  {
    name: "document",
    message: "`core/` must not reach the DOM; the host step belongs in `core/platform/browser/`.",
  },
  {
    name: "window",
    message:
      "`core/` must not reach the window; the host step belongs in `core/platform/browser/`.",
  },
];

const noDocumentLookupSyntax = {
  selector:
    "MemberExpression[object.name='document'][property.name=/^(querySelector|querySelectorAll|getElementById|getElementsByClassName|getElementsByTagName)$/]",
  message:
    "Do not look shell elements up in the document; the component that renders a slot hands the node over. See docs/architecture.md.",
};

export default [
  {
    ignores: [
      "dist/**",
      "release/**",
      "node_modules/**",
      ".agents/**",
      ".scratch/**",
      ".local-tools/**",
      "src-tauri/**",
      "src/backend/**",
      "src/public/**",
      "docs/**",
      "collaboration-server/**",
      // The SDK entry only forwards `src/core/api/sdk.ts`; tsc checks it there.
      "sdk/index.d.ts",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The editor core is a large hand-written layer migrated from JavaScript; unused locals are
      // signalled without failing the build.
      "no-unused-vars": [
        "warn",
        {
          args: "after-used",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-console": "off",
      "max-lines": ["error", { max: 800 }],
      // The legacy text-chart parser uses `while (true)` with explicit breaks.
      "no-constant-condition": ["error", { checkLoops: false }],
      // Ideographic spaces are deliberate separators in status text and canvas labels.
      "no-irregular-whitespace": [
        "error",
        { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true },
      ],
      eqeqeq: ["warn", "smart"],
      "prefer-const": "warn",
      "object-shorthand": ["warn", "properties"],
    },
  },
  {
    // Repository boundary rule: the design layer draws a chart event
    // through a locally declared structural type, never through product domain
    // code. Its allowed core leaves are core mechanisms with several consumers
    // (`core/state/values.ts`, `core/platform/`, `core/shortcuts/`,
    // `core/utils/easing.ts`), which these patterns do not touch.
    files: ["src/design/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/core/chart/**",
                "**/core/editor/**",
                "**/core/document/**",
                "**/core/media/**",
              ],
              message:
                "The design layer must not import product domain code; declare the fields it reads as a local structural type.",
            },
          ],
        },
      ],
    },
  },
  {
    // Repository boundary rule: a shell element is
    // handed to the engine as an argument, never looked up by a selector string.
    // A component may still query inside the subtree it owns (`panel.querySelector`),
    // which is why only `document.*` is banned here. `src/main.tsx` is the one
    // exception: it finds the React root, and there is nothing above it to own it.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/main.tsx"],
    rules: {
      "no-restricted-syntax": ["error", noDocumentLookupSyntax],
    },
  },
  {
    files: ["src/frontend/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/workspace/elements.ts", "**/workspace/shellRefs.ts"],
              message:
                "The string-selector slot registry is gone; slots travel into the engine as arguments.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/frontend/**", "**/design/**"],
              message:
                "Core logic must not depend on frontend or design modules; use data or injected callbacks.",
            },
          ],
        },
      ],
    },
  },
  {
    // Ticket 50: under `src/core/`, the host is reachable only through a platform
    // seam. The document-lookup rule is repeated here because a later block
    // replaces a rule rather than merging it, and this block is the one that
    // carries `no-restricted-syntax` for every core file the media and chart
    // blocks do not already cover.
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", ...hostAccessGlobals],
      "no-restricted-syntax": ["error", noDocumentLookupSyntax, ...hostAccessSyntax],
    },
  },
  {
    // `core/media` reads and decodes media; it does not talk to the host. Native
    // commands belong in `core/platform/`, and the browser side of a built-in
    // asset — the bundler glob, `document.baseURI`, the change event — belongs to
    // the frontend, which installs it through `media/noteSkins`'s hooks. Ticket
    // 13 removed the one file that had all three.
    files: ["src/core/media/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/frontend/**", "**/design/**"],
              message:
                "Core logic must not depend on frontend or design modules; use data or injected callbacks.",
            },
            {
              group: ["@tauri-apps/**"],
              message:
                "`core/media` must not call the host directly; put the adapter in `core/platform/` and inject it.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "document",
          message:
            "`core/media` must not reach the DOM; the frontend installs the browser side of a built-in asset.",
        },
        {
          name: "window",
          message:
            "`core/media` must not reach the window; the frontend installs the browser side of a built-in asset.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MetaProperty[meta.name='import']",
          message:
            "`core/media` must not use bundler-only syntax such as `import.meta.glob`; the frontend owns bundled assets.",
        },
        ...hostAccessSyntax,
      ],
    },
  },
  {
    // The chart domain describes the chart. It does not know where bytes come
    // from: shader text arrives through the injected `ShaderSourceLoader`, so a
    // new `fetch` inside this subtree is a boundary break rather than a detail.
    // This is ticket 03's guard, and the shape the rest of the structural
    // checks in ticket 05 follow.
    files: ["src/core/chart/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/frontend/**", "**/design/**"],
              message:
                "Core logic must not depend on frontend or design modules; use data or injected callbacks.",
            },
            {
              group: ["react", "react-dom", "react/**", "react-dom/**", "@tauri-apps/**"],
              message:
                "`core/chart` is the chart domain: no React, no Tauri. The host layer supplies the nodes and the bytes.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "`core/chart` must not touch the network; take the text as an argument.",
        },
        {
          name: "document",
          message: "`core/chart` must not reach the DOM; the host layer owns the nodes.",
        },
        {
          name: "window",
          message: "`core/chart` must not reach the window; the host layer owns the environment.",
        },
        {
          name: "localStorage",
          message: "`core/chart` must not read storage; persistence belongs to the host layer.",
        },
      ],
    },
  },
  {
    // Ticket 50: `core/platform/**` is where core is allowed to touch the host —
    // that is what a platform seam is (`desktop/` for Tauri and native commands,
    // `browser/` for the DOM and the browser's media primitives). The
    // document-lookup rule still applies: a seam answers a question about the
    // host, it does not go hunting for elements.
    files: ["src/core/platform/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": "off",
      "no-restricted-syntax": ["error", noDocumentLookupSyntax],
    },
  },
  {
    // The plugin facade's whole job is to install `window.redux`. That is not a
    // mechanism reaching the host, so it is the one file exempt from the global
    // rule — see docs/architecture.md.
    files: ["src/core/api/index.ts"],
    rules: {
      "no-restricted-globals": "off",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: { presets: ["@babel/preset-typescript"] },
      },
    },
    rules: {
      // tsc understands type-only identifiers; the core rule cannot see them.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        // TypeScript files keep `<T>expr` casts; only .tsx opts into JSX.
        babelOptions: {
          presets: ["@babel/preset-typescript"],
          plugins: ["@babel/plugin-syntax-jsx"],
        },
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // `eslint-plugin-react` used to be registered here for `react/jsx-uses-vars`,
      // but `no-unused-vars` is off for `.tsx` (tsc's `noUnusedLocals` owns unused
      // imports), so the rule could never fire. Dropping the plugin also removes
      // the last peer-dependency conflict with ESLint 10, which is what made a
      // plain `npm install` fail outright.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
  prettier,
  {
    // Must stay last: `eslint-config-prettier` above relaxes `curly` to a
    // one-line-only shape and switches `brace-style` off, so this block is what
    // actually enforces braces.
    //
    // Every control-flow body carries braces, including the single-statement
    // `if (cond) return;` form. A body without braces is the shape that makes a
    // diff dangerous: adding one line to `if (x) doA();` silently changes which
    // statements are guarded. `curly: all` also keeps `else if` chains flat and
    // leaves no place for a stray `;` to become an empty body.
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    rules: {
      curly: ["error", "all"],
    },
  },
];
