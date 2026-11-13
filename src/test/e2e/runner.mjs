/** Deterministic CDP runner for complete RPE Redux user journeys. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SmokeSession } from "../cdpHarness.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const DEFAULT_EXE = join(REPO, "src-tauri", "target", "debug", "rpe-redux.exe");
const SERVER_EXE = join(REPO, "src-tauri", "target", "debug", "rpe-redux-server.exe");
const ARTIFACTS = join(REPO, ".scratch", "e2e-smoke-quality", "artifacts");
const RUNS = join(REPO, ".scratch", "e2e-smoke-quality", "runs");
const START_ATTEMPTS = 3;

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function ownedRunPath(path) {
  const candidate = resolve(path);
  const relativePath = relative(resolve(RUNS), candidate);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Smoke profile is outside the owned run directory: ${candidate}`);
  }
  return candidate;
}

export function createIsolatedProfile() {
  mkdirSync(RUNS, { recursive: true });
  return mkdtempSync(join(RUNS, "run-"));
}

export async function removeIsolatedProfile(path) {
  const candidate = ownedRunPath(path);
  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(candidate, { recursive: true, force: true });
      return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50 * (attempt + 1)));
    }
  }
  if (lastError) {
    throw lastError;
  }
  return false;
}

function runtimeServerPath(profileDir) {
  return join(
    profileDir,
    "runtime",
    process.platform === "win32" ? "redux-service.exe" : "redux-service",
  );
}

function argument(name, fallback = undefined) {
  const prefix = `${name}=`;
  const value = process.argv.find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

export class SmokeRunner {
  constructor({
    timeoutMs = 45000,
    executable = DEFAULT_EXE,
    startupPath = null,
    startAtHome = false,
    profileDir = null,
  } = {}) {
    this.timeoutMs = timeoutMs;
    this.executable = resolve(executable);
    this.startupPath = startupPath;
    this.startAtHome = startAtHome;
    this.requestedProfileDir = profileDir ? ownedRunPath(profileDir) : null;
    this.profileDir = null;
    this.profileRemoved = false;
    this.session = null;
    this.process = null;
    this.client = null;
    this.currentScenario = "bootstrap";
    this.checks = 0;
    this.results = [];
  }

  async start() {
    let lastError;
    for (let attempt = 1; attempt <= START_ATTEMPTS; attempt += 1) {
      try {
        return await this.startOnce();
      } catch (error) {
        lastError = error;
        await this.session?.close({ crash: true }).catch(() => undefined);
        this.client = null;
        this.process = null;
        this.session = null;
        if (attempt === START_ATTEMPTS) {
          break;
        }
        // A previous smoke run can still hold the loopback service port or a
        // profile database lock for a moment after its process exits.
        if (!this.requestedProfileDir && this.profileDir && !this.profileRemoved) {
          await removeIsolatedProfile(this.profileDir).catch(() => undefined);
          this.profileDir = null;
          this.profileRemoved = false;
        }
        await sleep(1000 * attempt);
      }
    }
    throw lastError;
  }

  /** One launch attempt; the public `start` retries transient startup failures. */
  async startOnce() {
    this.profileDir = this.requestedProfileDir ?? createIsolatedProfile();
    this.session = new SmokeSession({
      executable: this.executable,
      args: [
        ...(this.startupPath ? [resolve(this.startupPath)] : []),
        `--user-data-dir=${this.profileDir}`,
      ],
      timeoutMs: this.timeoutMs,
      cleanupExecutables: [SERVER_EXE],
      cleanupAllExecutables: [runtimeServerPath(this.profileDir)],
    });
    await this.session.start();
    this.process = this.session.process;
    this.client = this.session.client;
    await this.client.command("Page.bringToFront").catch(() => {
      // Some WebView2 builds do not expose page activation; input still works through CDP.
    });
    const deadline = Date.now() + this.timeoutMs;
    await this.waitFor(
      "window.redux installation",
      () => this.evaluate("Boolean(globalThis.window?.redux)"),
      deadline,
    );
    await this.waitFor(
      "document runtime availability",
      () =>
        this.evaluate(
          "globalThis.window?.redux?.document?.availability?.().status === 'available'",
        ),
      deadline,
    );
    await this.waitFor(
      "editor surface mount",
      () =>
        this.evaluate(
          "Boolean(document.querySelector('.redux-app-shell #stage #realtime-preview') && document.querySelector('.redux-app-shell #notes') && document.querySelector('.redux-app-shell #events'))",
        ),
      deadline,
    );
    if (this.startupPath) {
      await this.waitFor(
        "startup chart installation",
        () =>
          this.evaluate(
            "globalThis.window?.redux?.document?.state?.().status === 'open' && Boolean(globalThis.window?.redux?.document?.state?.().path)",
          ),
        deadline,
      );
      // The document is installed before its loading modal finishes closing, and
      // a scenario that creates or replaces a document during that window races
      // the modal stack instead of the editor.
      await this.waitFor(
        "startup loading modal close",
        () =>
          this.evaluate(
            "!document.querySelector('dialog.redux-chart-loading[open]') && !document.querySelector('.redux-modal-scrim')",
          ),
        deadline,
      );
    } else if (this.startAtHome) {
      // Experience journeys start on the home screen and drive document creation
      // through the real shortcut and pointer paths instead of an installed chart.
      await this.waitFor(
        "home screen mount",
        () =>
          this.evaluate(
            "document.querySelector('.redux-app-shell')?.dataset.atHome === 'true' && document.querySelector('#home')?.hidden === false",
          ),
        deadline,
      );
    }
    return this;
  }

  async evaluate(expression) {
    if (!this.client) {
      throw new Error("Smoke runner is not connected");
    }
    return this.client.evaluate(expression);
  }

  /** Send a browser-protocol input command to the real packaged WebView. */
  async command(method, params = {}) {
    if (!this.client) {
      throw new Error("Smoke runner is not connected");
    }
    return this.client.command(method, params);
  }

  async callApi(expression) {
    return this.evaluate(`(async () => {
      const redux = globalThis.window?.redux;
      if (!redux) throw new Error("window.redux is not installed");
      return await (${expression});
    })()`);
  }

  async waitFor(label, predicate, deadline = Date.now() + this.timeoutMs) {
    let lastError = "predicate was false";
    while (Date.now() < deadline) {
      try {
        if (await predicate()) {
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    throw new Error(`Timed out waiting for ${label}: ${lastError}`);
  }

  assert(condition, message) {
    if (!condition) {
      throw new Error(`[${this.currentScenario}] ${message}`);
    }
    this.checks += 1;
  }

  async scenario(name, action) {
    this.currentScenario = name;
    const before = this.checks;
    const started = Date.now();
    try {
      await action();
      this.results.push({
        name,
        status: "passed",
        checks: this.checks - before,
        elapsedMs: Date.now() - started,
      });
    } catch (error) {
      this.results.push({
        name,
        status: "failed",
        checks: this.checks - before,
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async screenshot(name) {
    mkdirSync(ARTIFACTS, { recursive: true });
    const result = await this.client.command("Page.captureScreenshot", { format: "png" });
    const path = join(ARTIFACTS, `${name}.png`);
    writeFileSync(path, Buffer.from(result.data, "base64"));
    return path;
  }

  async close({ preserveProfile = false, crash = false } = {}) {
    await this.session?.close({ crash });
    if (this.profileDir && !preserveProfile && !this.profileRemoved) {
      try {
        await removeIsolatedProfile(this.profileDir);
        this.profileRemoved = true;
      } catch (error) {
        console.warn(`Smoke profile cleanup deferred: ${this.profileDir}`, error);
      }
    }
    this.client = null;
    this.process = null;
    this.session = null;
  }
}

/** The smoke command line: select one journey group or run them all. */
export function cliOptions() {
  return { scenario: argument("--scenario", "all") };
}
