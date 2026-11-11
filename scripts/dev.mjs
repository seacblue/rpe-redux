/**
 * Browser development loop.
 *
 * Starts the Go service and the Vite server together, injects the worktree's
 * fixed ports and the preference-write token into the browser bundle, and opens
 * the editor in the default browser. Native Tauri features stay in
 * `npm run dev:desktop`; the browser loop is the fast path for interface,
 * editor, and library work with hot reload.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, relative, resolve } from "node:path";
import { desktopPortArgument } from "./desktopLaunchOptions.mjs";
import { loadOrCreateDevPorts } from "./devPorts.mjs";

const root = resolve(import.meta.dirname, "..");
const backendDirectory = join(root, "src", "backend");
// The browser loop is served from its own root; a web deployment base belongs
// to `build:web`, not to the development origin.
delete process.env.REDUX_WEB_BASE;
const PREFERENCE_TOKEN_HEADER = "X-Redux-Preference-Token";
const READY_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Read one `--name value` or `--name=value` string argument. */
function stringArgument(argv, name) {
  const flag = `--${name}`;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith(`${flag}=`)) {
      return argument.slice(flag.length + 1);
    }
    if (argument === flag) {
      return argv[index + 1];
    }
  }
  return undefined;
}

/** Print the accepted flags for `npm run dev -- --help`. */
function printHelp() {
  console.log(`Usage: npm run dev -- [flags]

Starts the Go service and Vite with hot reload, then opens the browser.

  --frontend-port <port>  Pin the Vite port for this run.
  --backend-port <port>   Pin the local service port for this run.
  --ai-port <port>        Pin the Code Cell bridge port for this run.
  --collab-port <port>    Pin the collaboration room port for this run.
  --new-ports             Choose a new fixed port set for this worktree.
  --no-open               Start the servers without opening a browser.
  --data-dir <path>       Browser profile root (default .scratch/dev/data).
  --help                  Show this message.

The selected ports are stored in .scratch/dev/ports.json and reused by
npm run dev and npm run dev:desktop.`);
}

/** Resolve a short path for console output. */
function displayPath(path) {
  const value = relative(root, path) || ".";
  return value.startsWith("..") ? path : value;
}

/** Read the preference-write credential the service writes beside its database. */
async function readPreferenceCredential(dataDirectory) {
  try {
    const value = JSON.parse(
      await readFile(join(dataDirectory, "preferences-endpoint.json"), "utf8"),
    );
    const token = typeof value.token === "string" && value.token.trim() ? value.token : null;
    const header =
      typeof value.header === "string" && value.header.trim()
        ? value.header
        : PREFERENCE_TOKEN_HEADER;
    return { token, header };
  } catch {
    return { token: null, header: PREFERENCE_TOKEN_HEADER };
  }
}

/** Start the Go service and resolve once its readiness line arrives. */
function startBackend({ ports, origins, database }) {
  const docsDirectory = join(root, "docs-site-dist");
  const args = [
    "run",
    "./cmd/redux-service",
    "--host",
    "127.0.0.1",
    "--port",
    String(ports.backendPort),
    "--ai-port",
    String(ports.aiPort),
    "--collab-port",
    String(ports.collabPort),
    "--collab-host",
    "127.0.0.1",
    "--db",
    database,
    "--origins",
    origins.join(","),
    "--dev",
  ];
  if (existsSync(join(docsDirectory, "index.html"))) {
    args.push("--docs-dir", docsDirectory);
  }
  const child = spawn("go", args, {
    cwd: backendDirectory,
    env: { ...process.env, REDUX_SERVER_DEV: "1" },
    stdio: ["ignore", "pipe", "inherit"],
    windowsHide: true,
  });

  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  ready.catch(() => undefined);
  let settled = false;
  const finish = (error, event) => {
    if (settled) {
      return;
    }
    settled = true;
    if (error) {
      rejectReady(error);
    } else {
      resolveReady(event);
    }
  };

  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", (line) => {
    try {
      const event = JSON.parse(line);
      if (event?.event === "listening") {
        finish(null, event);
        return;
      }
    } catch {
      // Non-JSON output is service logging.
    }
    console.log(`[backend] ${line}`);
  });
  child.once("error", (error) => finish(error));
  child.once("exit", (code, signal) => {
    finish(
      new Error(
        `The Go service exited before it was ready (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
      ),
    );
  });

  const exited = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `The Go service did not report readiness within ${READY_TIMEOUT_MS / 1000} seconds.`,
        ),
      );
    }, READY_TIMEOUT_MS);
    timer.unref();
  });

  return { child, ready, exited, timeout, stdout };
}

/** Wait for one child process or a delay, whichever settles first. */
function waitForExit(exited, timeoutMs) {
  return Promise.race([
    exited.then(() => true),
    new Promise((resolveDelay) => {
      const timer = setTimeout(() => resolveDelay(false), timeoutMs);
      timer.unref();
    }),
  ]);
}

/** Open a URL in the platform's default browser without blocking the loop. */
function openBrowser(url) {
  if (process.env.CI) {
    return;
  }
  const [command, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch (error) {
    console.warn(`Could not open the browser automatically: ${String(error)}`);
  }
}

/** Run the browser development loop. */
async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  const ports = await loadOrCreateDevPorts(root, {
    overrides: {
      frontendPort: desktopPortArgument(argv, "frontend"),
      backendPort: desktopPortArgument(argv, "backend"),
      aiPort: desktopPortArgument(argv, "ai"),
      collabPort: desktopPortArgument(argv, "collab"),
    },
    fresh: argv.includes("--new-ports"),
  });

  const requestedDataDirectory = stringArgument(argv, "data-dir");
  const dataDirectory = resolve(root, requestedDataDirectory ?? join(".scratch", "dev", "data"));
  await mkdir(dataDirectory, { recursive: true });
  const database = join(dataDirectory, "redux.db");
  const origins = [
    `http://127.0.0.1:${ports.frontendPort}`,
    `http://localhost:${ports.frontendPort}`,
  ];

  const backend = startBackend({ ports, origins, database });
  let backendExited = false;
  void backend.exited.then(() => {
    backendExited = true;
  });

  let viteServer = null;
  let shuttingDown = false;
  let shutdownPromise = null;

  /** Stop Vite and ask the service to drain before force-killing its process tree. */
  async function shutdown(exitCode) {
    if (shutdownPromise) {
      return shutdownPromise;
    }
    shuttingDown = true;
    shutdownPromise = (async () => {
      if (viteServer) {
        await viteServer.close().catch((error) => {
          console.warn(`Could not close Vite cleanly: ${String(error)}`);
        });
      }
      if (!backendExited && backend.child.pid) {
        await fetch(`http://127.0.0.1:${ports.backendPort}/api/shutdown`, {
          method: "POST",
          headers: { "X-Redux-Client": "1" },
          signal: AbortSignal.timeout(2_000),
        }).catch(() => undefined);
        if (!(await waitForExit(backend.exited, SHUTDOWN_TIMEOUT_MS))) {
          if (process.platform === "win32") {
            spawnSync("taskkill", ["/pid", String(backend.child.pid), "/t", "/f"], {
              stdio: "ignore",
              windowsHide: true,
            });
          } else {
            backend.child.kill("SIGKILL");
          }
        }
      }
      backend.stdout.close();
      process.exitCode = exitCode;
    })();
    return shutdownPromise;
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void shutdown(0);
    });
  }

  try {
    const ready = await Promise.race([backend.ready, backend.timeout]);
    const credential = await readPreferenceCredential(dataDirectory);
    const devRuntime = {
      ports: {
        frontendPort: ports.frontendPort,
        backendPort: ports.backendPort,
        aiPort: ports.aiPort,
        collabPort: ports.collabPort,
      },
      preferenceToken: credential.token,
      preferenceHeader: credential.header,
    };

    process.env.REDUX_FRONTEND_PORT = String(ports.frontendPort);
    process.env.REDUX_DEV_RUNTIME = JSON.stringify(devRuntime);
    const { createServer } = await import("vite");
    viteServer = await createServer({
      root,
      configFile: join(root, "vite.config.ts"),
      server: { open: false },
    });
    await viteServer.listen();

    const url =
      viteServer.resolvedUrls?.local?.[0]?.replace(/\/$/u, "") ??
      `http://127.0.0.1:${ports.frontendPort}`;
    console.log("");
    console.log("RPE Redux browser development");
    console.log(`  App:     ${url}`);
    console.log(`  Backend: http://127.0.0.1:${ports.backendPort}`);
    console.log(`  Data:    ${displayPath(dataDirectory)} (${ready.db ?? database})`);
    console.log(`  Ports:   ${displayPath(resolve(root, ".scratch", "dev", "ports.json"))}`);
    console.log(
      "  Hot reload is active; native file dialogs and Tauri commands stay in dev:desktop.",
    );
    if (!credential.token) {
      console.log(
        "  Preference token unavailable; settings writes need the sidecar credential file.",
      );
    }
    console.log("");

    if (!argv.includes("--no-open")) {
      openBrowser(url);
    }

    void backend.exited.then(({ code, signal }) => {
      if (shuttingDown) {
        return;
      }
      if (code === 0) {
        void shutdown(0);
        return;
      }
      console.error(
        `The Go service stopped unexpectedly (code ${code ?? "none"}, signal ${signal ?? "none"}).`,
      );
      void shutdown(code && code !== 0 ? code : 1);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await shutdown(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
