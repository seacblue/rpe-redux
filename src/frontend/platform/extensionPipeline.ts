/**
 * Installs the Extension, host API, and Code Cell bridge after startup paints.
 *
 * The startup screen does not need the Extension sandbox, the full host facade,
 * or the Code Cell guide text. This module is small; its dynamic imports contain
 * the actual pipeline, so the initial page can load while the pipeline arrives.
 * The backend awaits the same promise before it loads packaged Extensions.
 */
import { isDesktop } from "../../core/platform/environment.ts";

let pipeline: Promise<void> | null = null;

/** Install the pipeline once and return the shared promise. */
export function ensureExtensionPipeline(): Promise<void> {
  pipeline ??= install();
  return pipeline;
}

/** Import the pipeline pieces, then install them in the order the shell expects. */
async function install(): Promise<void> {
  const [
    api,
    extensionApi,
    styleHost,
    themeTokens,
    scriptUi,
    extensionUi,
    codeCellBridge,
    shortcutBridge,
    sandbox,
    extensionRuntimeModule,
    codeCellModule,
    guideModule,
    guideText,
  ] = await Promise.all([
    import("../../core/api/index.ts"),
    import("../../core/extensions/extensionApi.ts"),
    import("./extensionStyleHost.ts"),
    import("./extensionThemeTokens.ts"),
    import("./ScriptUiHost.tsx"),
    import("./extensionUiHost.ts"),
    import("./codeCellBridge.ts"),
    import("./extensionShortcutBridge.ts"),
    import("./extensionSandbox.tsx"),
    import("../../core/extensions/extensionRuntime.ts"),
    import("../../core/codecell/runtime.ts"),
    import("../../core/edit/codecell/guide.ts"),
    import("../../../sdk/llm-guide.md?raw"),
  ]);

  api.installReduxApi();
  codeCellModule.installCodeCellApi(window);
  extensionApi.connectExtensionApi(api.redux);
  styleHost.installExtensionStyleHost();
  themeTokens.installExtensionThemeTokens();
  scriptUi.installScriptUiHost();
  extensionUi.installExtensionUiHost();
  codeCellBridge.installCodeCellBridge();
  extensionRuntimeModule.extensionRuntime.setSandboxFactory(sandbox.createExtensionSandbox);
  codeCellModule.codeCellRuntime.setSandboxFactory(sandbox.createExtensionSandbox);
  guideModule.connectCodeCellGuide(guideText.default);
  shortcutBridge.installExtensionRecovery();

  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    // The native deadline is twelve seconds; five seconds keeps a wide margin
    // while cutting the steady IPC wake-ups.
    const heartbeat = globalThis.setInterval(() => {
      void invoke("extension_watchdog_heartbeat", {
        active:
          document.visibilityState === "visible" &&
          extensionRuntimeModule.extensionRuntime.list().length > 0,
      }).catch(() => undefined);
    }, 5000);
    window.addEventListener("beforeunload", () => globalThis.clearInterval(heartbeat), {
      once: true,
    });
  }
}
