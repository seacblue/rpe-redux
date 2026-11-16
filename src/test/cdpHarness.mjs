/** Shared Windows process, local-port, and CDP lifecycle for smoke scripts. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";

export function processIds(executablePath) {
  if (process.platform !== "win32") {
    return new Set();
  }
  const escaped = executablePath.replaceAll("'", "''");
  const command =
    `Get-CimInstance Win32_Process | ` +
    `Where-Object { $_.ExecutablePath -eq '${escaped}' } | ` +
    "Select-Object -ExpandProperty ProcessId";
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true },
  );
  return new Set(
    String(result.stdout ?? "")
      .split(/\r?\n/)
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  );
}

export function stopNewProcesses(before, executablePath) {
  for (const pid of processIds(executablePath)) {
    if (before.has(pid)) {
      continue;
    }
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
}

export async function reservePort(requestedPort = 0) {
  if (requestedPort !== 0) {
    return requestedPort;
  }
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) {
    throw new Error("Unable to reserve a local CDP port");
  }
  return port;
}

export async function waitForTarget(port, deadline, processHandle, { pollMs = 100 } = {}) {
  let lastError = "CDP endpoint has not answered";
  while (Date.now() < deadline) {
    if (processHandle?.exitCode !== null && processHandle?.exitCode !== undefined) {
      throw new Error(`Application exited with code ${processHandle.exitCode}: ${lastError}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const pages = targets.filter(
          (entry) => entry.type === "page" && typeof entry.webSocketDebuggerUrl === "string",
        );
        const target = pages.find((entry) => entry.url && entry.url !== "about:blank") ?? pages[0];
        if (target) {
          return target;
        }
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs));
  }
  throw new Error(`Timed out waiting for CDP: ${lastError}`);
}

export class CdpClient {
  constructor(url) {
    this.nextId = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket open timed out")), 5000);
      const open = () => {
        clearTimeout(timer);
        resolvePromise();
      };
      const error = () => {
        clearTimeout(timer);
        reject(new Error("CDP WebSocket failed"));
      };
      this.socket.addEventListener("open", open, { once: true });
      this.socket.addEventListener("error", error, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      void this.receive(event.data).catch((error) => {
        for (const { reject } of this.pending.values()) {
          reject(error);
        }
        this.pending.clear();
      });
    });
    this.socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("CDP WebSocket closed"));
      }
      this.pending.clear();
    });
  }

  async receive(data) {
    let text;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(new Uint8Array(data));
    } else if (ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(
        new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      );
    } else if (typeof Blob !== "undefined" && data instanceof Blob) {
      text = await data.text();
    } else {
      throw new Error("Unsupported CDP message payload");
    }
    const message = JSON.parse(text);
    if (!message.id) {
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) {
      return;
    }
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  }

  async command(method, params = {}, timeoutMs = 10000) {
    await this.ready;
    const id = ++this.nextId;
    const result = new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
    });
    const timer = setTimeout(() => {
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        pending.reject(new Error(`CDP command timed out: ${method}`));
      }
    }, timeoutMs);
    this.socket.send(JSON.stringify({ id, method, params }));
    try {
      return await result;
    } finally {
      clearTimeout(timer);
    }
  }

  async evaluate(
    expression,
    { noValueMessage = "Runtime.evaluate returned no value", timeoutMs = 10000 } = {},
  ) {
    const response = await this.command(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
      timeoutMs,
    );
    if (response.exceptionDetails) {
      const description =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Runtime.evaluate failed";
      throw new Error(description);
    }
    if (!Object.hasOwn(response.result, "value")) {
      throw new Error(noValueMessage);
    }
    return response.result.value;
  }

  /**
   * Calls a fixed browser function with structured CDP arguments.
   *
   * The function declaration is kept separate from argument values so callers
   * do not have to construct executable JavaScript from runtime data.
   */
  async callFunction(
    functionDeclaration,
    args = [],
    { noValueMessage = "Runtime.callFunctionOn returned no value", timeoutMs = 10000 } = {},
  ) {
    const global = await this.command(
      "Runtime.evaluate",
      { expression: "globalThis", returnByValue: false },
      timeoutMs,
    );
    const objectId = global.result?.objectId;
    if (!objectId) {
      throw new Error("Runtime.evaluate did not return a global object");
    }
    const response = await this.command(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
      timeoutMs,
    );
    if (response.exceptionDetails) {
      const description =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "Runtime.callFunctionOn failed";
      throw new Error(description);
    }
    if (!Object.hasOwn(response.result, "value")) {
      throw new Error(noValueMessage);
    }
    return response.result.value;
  }

  close() {
    if (
      this.socket.readyState === WebSocket.OPEN ||
      this.socket.readyState === WebSocket.CONNECTING
    ) {
      this.socket.close();
    }
  }

  async closeBrowser() {
    await this.command("Browser.close");
  }
}

export async function terminateProcess(processHandle, timeoutMs = 1500) {
  if (!processHandle) {
    return;
  }
  const waitForExit = () =>
    new Promise((resolvePromise) => {
      if (processHandle.exitCode !== null) {
        resolvePromise();
        return;
      }
      const timer = setTimeout(resolvePromise, timeoutMs);
      processHandle.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  await waitForExit();
  if (processHandle.exitCode === null) {
    if (processHandle.pid && process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(processHandle.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      processHandle.kill();
    }
    await waitForExit();
  }
}

/**
 * Owns one smoke application's process, port, CDP target, and teardown.
 *
 * Callers provide only application arguments and executable paths whose child
 * processes must be guarded. Scenario modules keep their own oracle and
 * profile semantics behind this lifecycle seam.
 */
export class SmokeSession {
  constructor({
    executable,
    args = [],
    attach = false,
    port = 0,
    timeoutMs = 45000,
    cleanupExecutables = [],
    cleanupAllExecutables = [],
  } = {}) {
    this.executable = executable;
    this.args = args;
    this.attach = attach;
    this.requestedPort = port;
    this.timeoutMs = timeoutMs;
    this.cleanupExecutables = cleanupExecutables;
    this.cleanupAllExecutables = cleanupAllExecutables;
    this.port = 0;
    this.process = null;
    this.client = null;
    this.processBaselines = new Map();
  }

  async start() {
    this.port = await reservePort(this.requestedPort);
    const deadline = Date.now() + this.timeoutMs;
    if (!this.attach) {
      if (!this.executable || !existsSync(this.executable)) {
        throw new Error(`Debug executable not found: ${this.executable}`);
      }
      for (const executablePath of this.cleanupExecutables) {
        this.processBaselines.set(executablePath, processIds(executablePath));
      }
      this.process = spawn(
        this.executable,
        [...this.args, `--remote-debugging-port=${this.port}`],
        { stdio: "ignore", windowsHide: true },
      );
    }
    const target = await waitForTarget(this.port, deadline, this.process);
    this.client = new CdpClient(target.webSocketDebuggerUrl);
    return this;
  }

  async close({ crash = false } = {}) {
    if (!crash && this.client && !this.attach) {
      try {
        await Promise.race([
          this.client.closeBrowser(),
          new Promise((resolvePromise) => setTimeout(resolvePromise, 1000)),
        ]);
      } catch {
        // The application may close the CDP socket before acknowledging Browser.close.
      }
    }
    this.client?.close();
    await terminateProcess(this.process);
    if (!this.attach) {
      for (const executablePath of this.cleanupExecutables) {
        stopNewProcesses(this.processBaselines.get(executablePath) ?? new Set(), executablePath);
      }
      for (const executablePath of this.cleanupAllExecutables) {
        stopNewProcesses(new Set(), executablePath);
      }
    }
    this.client = null;
    this.process = null;
  }
}
