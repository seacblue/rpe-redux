/// <reference types="vite/client" />

/** Product version baked in from `package.json` at build time (see `vite.config.ts`). */
declare const __REDUX_VERSION__: string;

/** Ports and credentials injected by the browser development server. */
interface ReduxBrowserDevRuntime {
  readonly ports: {
    readonly frontendPort: number;
    readonly backendPort: number;
    readonly aiPort: number;
    readonly collabPort: number;
  };
  readonly preferenceToken: string | null;
  readonly preferenceHeader: string;
}

/** Browser-development settings; undefined when the page was not served by `scripts/dev.mjs`. */
declare const __REDUX_DEV_RUNTIME__: ReduxBrowserDevRuntime | undefined;
