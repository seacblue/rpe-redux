/** Public document and values contract journeys. */
import { readFileSync } from "node:fs";
import { ensureFixtures } from "./fixtures.mjs";
import { closeDocument, createCanonical, expression } from "./journeySupport.mjs";

const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
).version;

const SANDBOX_BRIDGE_SOURCE = `
export default {
  async activate(context) {
    const result = {
      value: {},
      timers: {},
      globals: {},
      errors: {},
    };
    const handle = await context.api.values.define({ id: "probe", initial: "initial" });
    result.value.id = handle.id;
    result.value.initial = await handle.get();
    await handle.set("set-value");
    result.value.set = await handle.get();
    await handle.update("updated");
    result.value.updated = await handle.get();
    result.value.hasSubscribeKey = typeof handle.subscribeKey === "function";
    let updates = 0;
    const stop = await handle.subscribe(() => {
      updates += 1;
    });
    await context.api.values.byId.set("extension.mock.probe", "by-id");
    result.value.updates = updates;
    stop();
    await context.api.values.byId.set("extension.mock.probe", "after-stop");
    result.value.updatesAfterStop = updates;
    result.value.byId = await context.api.values.byId.get("extension.mock.probe");
    const fetched = await context.api.values.getHandle("extension.mock.probe");
    result.value.fetched = await fetched.get();
    try {
      await context.api.values.getHandle("missing.value");
    } catch (error) {
      result.errors.missing = error.message;
    }
    try {
      await context.api.values.define({ id: "probe", initial: "duplicate" });
    } catch (error) {
      result.errors.duplicate = error.message;
    }

    const fired = [];
    const timeout = context.timers.setTimeout(() => fired.push("timeout"), 5);
    result.timers.timeoutHandle = typeof timeout;
    await new Promise((resolve) => {
      context.timers.setTimeout(resolve, 10);
    });
    result.timers.fired = fired.length;
    const interval = context.timers.setInterval(() => {}, 1);
    result.timers.intervalHandle = typeof interval;
    context.timers.clearInterval(interval);
    const frame = context.timers.requestAnimationFrame(() => {});
    result.timers.frameHandle = typeof frame;
    context.timers.cancelAnimationFrame(frame);
    const pending = [];
    for (let index = 0; index < 64; index += 1) {
      pending.push(context.timers.setTimeout(() => {}, 1_000));
    }
    try {
      context.timers.setTimeout(() => {}, 1_000);
    } catch (error) {
      result.timers.overflow = error.message;
    }
    for (const handle of pending) {
      context.timers.clearTimeout(handle);
    }

    try {
      setTimeout(() => {}, 0);
      result.globals.setTimeout = "allowed";
    } catch (error) {
      result.globals.setTimeout = error.message;
    }
    try {
      delete globalThis.setTimeout;
    } catch (error) {
      result.globals.deleteSetTimeout = error.message;
    }
    try {
      setTimeout(() => {}, 0);
      result.globals.setTimeoutAfterDelete = "allowed";
    } catch (error) {
      result.globals.setTimeoutAfterDelete = error.message;
    }
    try {
      Object.getPrototypeOf(globalThis).setTimeout(() => {}, 0);
      result.globals.prototypeSetTimeout = "allowed";
    } catch (error) {
      result.globals.prototypeSetTimeout = error.message;
    }
    try {
      setInterval(() => {}, 1);
      result.globals.setInterval = "allowed";
    } catch (error) {
      result.globals.setInterval = error.message;
    }
    try {
      requestAnimationFrame(() => {});
      result.globals.requestAnimationFrame = "allowed";
    } catch (error) {
      result.globals.requestAnimationFrame = error.message;
    }
    try {
      if (typeof globalThis.setImmediate === "function") {
        globalThis.setImmediate(() => {});
        result.globals.setImmediate = "allowed";
      } else {
        result.globals.setImmediate = "missing";
      }
    } catch (error) {
      result.globals.setImmediate = error.message;
    }
    result.isolation = {
      tauri: typeof window.__TAURI__,
      externalFrozen: Object.isFrozen(window.external),
      chromeFrozen: Object.isFrozen(window.chrome),
      chromeConfigurable:
        Object.getOwnPropertyDescriptor(window, "chrome")?.configurable ?? null,
      webviewPostMessage: (() => {
        try {
          window.chrome.webview.postMessage("probe");
          return "allowed";
        } catch {
          return "blocked";
        }
      })(),
      ipcPostMessage: (() => {
        try {
          window.ipc.postMessage("probe");
          return "allowed";
        } catch {
          return "blocked";
        }
      })(),
      chromeRestore: (() => {
        try {
          window.chrome = { webview: { postMessage() {} } };
          return "allowed";
        } catch {
          return "blocked";
        }
      })(),
      open: (() => {
        try {
          window.open("about:blank");
          return "allowed";
        } catch {
          return "blocked";
        }
      })(),
      parent: (() => {
        try {
          return window.parent.location.href;
        } catch {
          return "blocked";
        }
      })(),
      opener: window.opener === null ? "null" : typeof window.opener,
    };
    result.isolation.invoke = await (async () => {
      if (typeof window.__TAURI_INTERNALS__?.invoke !== "function") {
        return "missing";
      }
      return await Promise.race([
        window.__TAURI_INTERNALS__.invoke("host_platform", {}).then(
          () => "allowed",
          (error) => "rejected: " + (error?.message ?? error),
        ),
        new Promise((resolve) => {
          context.timers.setTimeout(() => resolve("timeout"), 50);
        }),
      ]);
    })();
    context.ui.notice(JSON.stringify(result));
  },
};
`;

/** Exercises the iframe half of the values/timer bridge against a local host mock. */
async function extensionSandboxBridge(runner) {
  const packageSource = expression(SANDBOX_BRIDGE_SOURCE);
  const bridge = await runner.evaluate(`(async () => {
    const packageSource = ${packageSource};
    const token = "e2e-bridge-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.cssText =
      "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-10000px;top:-10000px";
    const ready = new Promise((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("sandbox bridge did not become ready")),
        5_000,
      );
      const onReady = (event) => {
        if (
          event.source !== iframe.contentWindow ||
          event.data?.type !== "redux-sandbox-ready" ||
          event.data?.token !== token
        ) {
          return;
        }
        window.clearTimeout(timer);
        window.removeEventListener("message", onReady);
        resolve();
      };
      window.addEventListener("message", onReady);
    });
    const source = new URL("extension-sandbox.html", location.href);
    source.searchParams.set("token", token);
    iframe.src = source.href;
    document.body.append(iframe);
    try {
      await ready;
      const channel = new MessageChannel();
      const port = channel.port1;
      const values = new Map();
      const valueHandles = new Map();
      const localIds = new Map();
      let nextValue = 1;
      let nextDisposer = 1;
      let nextTimer = 1;
      const subscriptions = new Map();
      const hostTimers = new Map();
      const notices = [];
      let intervalDelay = 0;
      let loadedResolve;
      let loadedReject;
      const loaded = new Promise((resolve, reject) => {
        loadedResolve = resolve;
        loadedReject = reject;
      });
      const decode = (value) => {
        if (Array.isArray(value)) {
          return value.map(decode);
        }
        if (value && typeof value === "object") {
          if (typeof value.__callback === "number") {
            const id = value.__callback;
            return (...args) => port.postMessage({ type: "callback", id, args });
          }
          const decoded = {};
          for (const [key, entry] of Object.entries(value)) {
            decoded[key] = decode(entry);
          }
          return decoded;
        }
        return value;
      };
      const notify = (id) => {
        for (const listener of [...subscriptions.values()]) {
          listener(id);
        }
      };
      const requireValue = (id) => {
        const valueId = valueHandles.get(String(id));
        if (!valueId) {
          throw new Error("Extension value handle is not available");
        }
        return valueId;
      };
      const defineValue = (definition) => {
        const localId = definition?.id;
        if (typeof localId !== "string" || !localId) {
          throw new Error("Value id must be non-empty");
        }
        if (localIds.has(localId)) {
          throw new Error("Value id is already defined by this Extension: " + localId);
        }
        const fullId = "extension.mock." + localId;
        localIds.set(localId, fullId);
        values.set(fullId, definition.initial);
        const bridgeId = "value:" + nextValue++;
        valueHandles.set(bridgeId, fullId);
        return { __valueHandle: bridgeId, id: fullId };
      };
      const callApi = (path, callArgs) => {
        if (!Array.isArray(path)) {
          throw new Error("Extension API path is invalid");
        }
        if (path[0] === "values" && path[1] === "define") {
          return defineValue(callArgs[0]);
        }
        if (path[0] === "values" && path[1] === "getHandle") {
          const fullId = localIds.get(callArgs[0]) ?? callArgs[0];
          if (!values.has(fullId)) {
            throw new Error("Value is not defined: " + callArgs[0]);
          }
          let bridgeId = [...valueHandles].find(([, id]) => id === fullId)?.[0];
          if (!bridgeId) {
            bridgeId = "value:" + nextValue++;
            valueHandles.set(bridgeId, fullId);
          }
          return { __valueHandle: bridgeId, id: fullId };
        }
        if (path[0] === "values" && path[1] === "byId" && path[2] === "get") {
          return values.get(String(callArgs[0]));
        }
        if (path[0] === "values" && path[1] === "byId" && path[2] === "set") {
          const id = String(callArgs[0]);
          values.set(id, callArgs[1]);
          notify(id);
          return undefined;
        }
        throw new Error("Unsupported API path: " + path.join("."));
      };
      const handleTimer = (method, args) => {
        if (method === "timers.setTimeout" || method === "timers.setInterval") {
          const callback = args[0];
          const delay = typeof args[1] === "number" ? args[1] : 0;
          if (method === "timers.setInterval") {
            intervalDelay = delay;
          }
          const handle = nextTimer++;
          if (method === "timers.setTimeout" && delay <= 50) {
            const hostHandle = window.setTimeout(() => {
              hostTimers.delete(handle);
              callback();
            }, delay);
            hostTimers.set(handle, hostHandle);
          }
          return handle;
        }
        if (method === "timers.requestAnimationFrame") {
          return nextTimer++;
        }
        if (method === "timers.clearTimeout") {
          const hostHandle = hostTimers.get(Number(args[0]));
          if (hostHandle !== undefined) {
            window.clearTimeout(hostHandle);
            hostTimers.delete(Number(args[0]));
          }
          return undefined;
        }
        if (
          method === "timers.clearInterval" ||
          method === "timers.cancelAnimationFrame"
        ) {
          return undefined;
        }
        throw new Error("Unsupported timer method: " + method);
      };
      port.onmessage = (event) => {
        const message = event.data;
        if (!message || typeof message !== "object") {
          return;
        }
        if (message.type === "rpc") {
          const args = decode(Array.isArray(message.args) ? message.args : []);
          try {
            let value;
            if (message.method === "api.call") {
              value = callApi(args[0], args[1]);
            } else if (message.method === "values.get") {
              value = values.get(requireValue(args[0]));
            } else if (message.method === "values.set") {
              const id = requireValue(args[0]);
              values.set(id, args[1]);
              notify(id);
              value = undefined;
            } else if (message.method === "values.update") {
              const id = requireValue(args[0]);
              values.set(id, args[1]);
              notify(id);
              value = undefined;
            } else if (message.method === "values.subscribe") {
              const id = "disposer:" + nextDisposer++;
              subscriptions.set(id, args[1]);
              value = { __disposer: id };
            } else {
              value = handleTimer(message.method, args);
            }
            port.postMessage({ type: "rpc-result", id: message.id, ok: true, value });
          } catch (error) {
            port.postMessage({
              type: "rpc-result",
              id: message.id,
              ok: false,
              error: { message: error instanceof Error ? error.message : String(error) },
            });
          }
          return;
        }
        if (message.type === "notify") {
          const args = decode(Array.isArray(message.args) ? message.args : []);
          if (message.method === "ui.notice") {
            notices.push(args[0]);
          }
          return;
        }
        if (message.type === "dispose-handle") {
          subscriptions.delete(String(message.id));
          return;
        }
        if (message.type === "loaded") {
          if (message.ok === true) {
            loadedResolve();
          } else {
            loadedReject(new Error(String(message.error ?? "sandbox activation failed")));
          }
          return;
        }
        if (message.type === "failure") {
          loadedReject(new Error(String(message.error ?? "sandbox failure")));
        }
      };
      port.start();
      iframe.contentWindow.postMessage({ type: "redux-sandbox-init", token }, "*", [
        channel.port2,
      ]);
      port.postMessage({
        type: "load",
        source: packageSource,
        manifest: {
          id: "extension.mock",
          name: "Bridge mock",
          version: "1.0.0",
          engines: { "rpe-redux": 1 },
          capabilities: ["values", "timers"],
        },
        capabilities: ["values", "timers"],
        limits: { maxTimers: 64, minIntervalMs: 16 },
        translations: {},
        language: "en",
        version: "0.0.0",
      });
      const timeout = new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("sandbox bridge timed out")), 5_000);
      });
      await Promise.race([loaded, timeout]);
      const notice = notices.at(-1);
      if (typeof notice !== "string") {
        throw new Error("sandbox bridge did not report its result");
      }
      port.close();
      return { result: JSON.parse(notice), intervalDelay };
    } finally {
      iframe.remove();
    }
  })()`);
  const result = bridge.result;
  runner.assert(result.value.id === "extension.mock.probe", "sandbox define returned the wrong id");
  runner.assert(
    result.value.initial === "initial",
    "sandbox define returned the wrong initial value",
  );
  runner.assert(result.value.set === "set-value", "sandbox handle.set did not reach the host");
  runner.assert(result.value.updated === "updated", "sandbox handle.update did not reach the host");
  runner.assert(result.value.hasSubscribeKey === true, "sandbox handle lost subscribeKey");
  runner.assert(result.value.updates === 1, "sandbox value subscription did not fire");
  runner.assert(
    result.value.updatesAfterStop === 1,
    "sandbox value subscription disposer did not run",
  );
  runner.assert(result.value.byId === "after-stop", "sandbox byId did not reach the host");
  runner.assert(result.value.fetched === "after-stop", "sandbox getHandle did not resolve");
  runner.assert(
    String(result.errors.missing).includes("Value is not defined"),
    "sandbox getHandle error did not reach the script",
  );
  runner.assert(
    String(result.errors.duplicate).includes("already defined"),
    "sandbox duplicate define error did not reach the script",
  );
  runner.assert(
    result.timers.timeoutHandle === "number" && result.timers.fired === 1,
    "sandbox timeout did not bridge its callback",
  );
  runner.assert(
    result.timers.intervalHandle === "number",
    "sandbox interval did not return a handle",
  );
  runner.assert(result.timers.frameHandle === "number", "sandbox frame did not return a handle");
  runner.assert(
    String(result.timers.overflow).includes("limit reached: 64"),
    "sandbox timer limit did not throw at the host budget",
  );
  runner.assert(
    bridge.intervalDelay >= 16,
    `sandbox interval was not clamped to 16 ms: ${bridge.intervalDelay}`,
  );
  for (const name of [
    "setTimeout",
    "setTimeoutAfterDelete",
    "setInterval",
    "requestAnimationFrame",
    "setImmediate",
  ]) {
    runner.assert(
      String(result.globals[name]).includes("context.timers"),
      `sandbox global ${name} was not blocked: ${result.globals[name]}`,
    );
  }
  const prototypeTimer = String(result.globals.prototypeSetTimeout);
  runner.assert(
    prototypeTimer.includes("context.timers") || prototypeTimer.includes("not a function"),
    `sandbox prototype timer was not blocked: ${prototypeTimer}`,
  );
  const isolation = result.isolation;
  runner.assert(isolation.tauri === "undefined", "Tauri facade reached the package realm");
  runner.assert(isolation.externalFrozen === true, "window.external is not frozen");
  runner.assert(isolation.chromeFrozen === true, "window.chrome is not frozen");
  runner.assert(
    isolation.chromeConfigurable === false,
    "window.chrome can still be replaced by package code",
  );
  runner.assert(
    isolation.webviewPostMessage === "blocked",
    `host webview IPC is reachable: ${isolation.webviewPostMessage}`,
  );
  runner.assert(
    isolation.ipcPostMessage === "blocked",
    `window.ipc is reachable: ${isolation.ipcPostMessage}`,
  );
  runner.assert(
    isolation.chromeRestore === "blocked",
    "package code restored the host chrome object",
  );
  runner.assert(isolation.open === "blocked", "package code opened a host window");
  runner.assert(isolation.parent === "blocked", "package code reached the host parent frame");
  runner.assert(isolation.opener === "null", "package code received a host opener");
  runner.assert(
    !String(isolation.invoke).startsWith("allowed"),
    `package code invoked a native command: ${isolation.invoke}`,
  );
}

export async function replacePolicy(runner) {
  const paths = ensureFixtures();
  await createCanonical(runner, "e2e-replace-policy.json");
  const edited = await runner.callApi(
    `window.redux.transaction.apply(${expression({
      label: "e2e replacement guard",
      metadata: { name: "Unsaved Replacement" },
    })})`,
  );
  runner.assert(
    edited.ok === true && edited.value.status === "committed",
    "replacement guard edit did not commit",
  );
  const before = await runner.callApi("window.redux.document.state().fingerprint");
  const rejected = await runner.callApi(
    `window.redux.document.openPath(${expression(paths.json)}, { replace: "reject" })`,
  );
  runner.assert(rejected.ok === false, "dirty replacement with reject policy was accepted");
  runner.assert(
    (await runner.callApi("window.redux.document.state().fingerprint")) === before,
    "rejected replacement changed the current document",
  );
  const discarded = await runner.callApi(
    `window.redux.document.openPath(${expression(paths.json)}, { replace: "discard" })`,
  );
  runner.assert(discarded.ok === true, "discard replacement was not accepted");
  const state = await runner.callApi("window.redux.document.state()");
  const actualPath = String(state.path ?? "")
    .replaceAll("\\", "/")
    .toLowerCase();
  const expectedPath = paths.json.replaceAll("\\", "/").toLowerCase();
  runner.assert(
    actualPath.endsWith(expectedPath),
    `discard replacement opened the wrong path: ${JSON.stringify({ expected: paths.json, state })}`,
  );
  runner.assert(state.dirty === false, "discard replacement retained dirty state");
  await closeDocument(runner);
}

export async function apiContract(runner) {
  const shape = await runner.evaluate(`(() => {
    const redux = window.redux;
    return {
      frozen: Object.isFrozen(redux),
      version: redux?.version,
      hasSetShortcut: Object.hasOwn(redux?.values ?? {}, 'set'),
      hasDefine: typeof redux?.values?.define === 'function',
      hasGetHandle: typeof redux?.values?.getHandle === 'function',
      hasById: typeof redux?.values?.byId?.set === 'function',
      availability: redux?.document?.availability()?.status,
    };
  })()`);
  runner.assert(shape.frozen, "public redux facade is not frozen");
  runner.assert(
    shape.version === PACKAGE_VERSION,
    `redux version does not match package.json: ${shape.version} !== ${PACKAGE_VERSION}`,
  );
  runner.assert(!shape.hasSetShortcut, "values.set leaked into the public API");
  runner.assert(shape.hasDefine && shape.hasGetHandle && shape.hasById, "values API is incomplete");
  runner.assert(shape.availability === "available", "document API is unavailable");

  const valueId = `smoke.contract.${Date.now()}`;
  const value = await runner.callApi(`(() => {
    const handle = window.redux.values.define({ id: ${expression(valueId)}, initial: 'initial' });
    handle.set('handle-value');
    window.redux.values.byId.set(${expression(valueId)}, 'dynamic-value');
    return {
      handle: handle.get(),
      dynamic: window.redux.values.byId.get(${expression(valueId)}),
      sameHandle: window.redux.values.getHandle(${expression(valueId)}) === handle,
    };
  })()`);
  runner.assert(value.handle === "dynamic-value", "value handle did not observe byId writes");
  runner.assert(value.dynamic === "dynamic-value", "byId value was not readable");
  runner.assert(value.sameHandle, "getHandle did not return the registered handle");

  const directHandles = await runner.evaluate(`({
    workspace: typeof window.redux.workspace?.drawerPane === "function",
    help: typeof window.redux.help?.openChangelog === "function",
  })`);
  runner.assert(
    directHandles.workspace && directHandles.help,
    `direct workspace/help handles are missing: ${JSON.stringify(directHandles)}`,
  );

  await extensionSandboxBridge(runner);

  // Extension activation is asynchronous: the package is listed before its
  // sandbox iframe has mounted. Wait for the code package and its frame instead
  // of sampling the DOM at one arbitrary instant.
  await runner.waitFor(
    "code Extension activation",
    () =>
      runner.evaluate(`(() => {
        const code = window.redux.extensions
          .list()
          .filter((entry) => entry.content === 'code');
        const frame = document.querySelector('iframe[data-extension-sandbox]');
        return code.length > 0 &&
          code.every((entry) => entry.status === 'enabled' || entry.status === 'loaded') &&
          frame !== null;
      })()`),
    Date.now() + 8_000,
  );

  const sandbox = await runner.evaluate(`(() => {
    const frames = [...document.querySelectorAll('iframe[data-extension-sandbox]')];
    const code = window.redux.extensions
      .list()
      .filter((entry) => entry.content === 'code')
      .map((entry) => ({ id: entry.manifest.id, status: entry.status, error: entry.error }));
    return {
      risk: window.redux.extensions.riskNotice,
      frames: frames.map((frame) => ({
        sandbox: frame.getAttribute('sandbox'),
        src: frame.getAttribute('src'),
      })),
      code,
    };
  })()`);
  runner.assert(
    typeof sandbox.risk === "string" && sandbox.risk.trim().length > 0,
    `Extension risk notice is missing: ${JSON.stringify(sandbox.risk)}`,
  );
  runner.assert(
    sandbox.code.length > 0 &&
      sandbox.code.every((entry) => entry.status === "enabled" || entry.status === "loaded"),
    `code Extension did not load in the sandbox: ${JSON.stringify(sandbox.code)}`,
  );
  runner.assert(
    sandbox.frames.length > 0 &&
      sandbox.frames.every(
        (frame) =>
          frame.sandbox === "allow-scripts" &&
          !frame.sandbox.includes("allow-same-origin") &&
          frame.src.includes("extension-sandbox.html"),
      ),
    `Extension sandbox frame is missing or has the wrong policy: ${JSON.stringify(sandbox.frames)}`,
  );
}
