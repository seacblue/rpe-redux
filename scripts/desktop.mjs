/**
 * Desktop development loop.
 *
 * Resolves the worktree's fixed development ports, stages the native
 * prerequisites once, and hands the window and the Vite server to the Tauri
 * CLI. Browser-only work uses `npm run dev`; this path is for native dialogs,
 * WebView2 behaviour, and the packaged runtime.
 */
import { resolve } from "node:path";
import { prepareDesktopPrerequisites } from "./desktopPrerequisites.mjs";
import { desktopPortArgument } from "./desktopLaunchOptions.mjs";
import { loadOrCreateDevPorts } from "./devPorts.mjs";
import { runTauri } from "./tauriCli.mjs";

const root = resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Usage: npm run dev:desktop -- [flags]

Stages the Go sidecar and media helpers, then opens the Tauri window.

  --frontend-port <port>  Pin the Vite port for this run.
  --backend-port <port>   Pin the local service port for this run.
  --ai-port <port>        Pin the Code Cell bridge port for this run.
  --collab-port <port>    Pin the collaboration room port for this run.
  --new-ports             Choose a new fixed port set for this worktree.

The selected ports are stored in .scratch/dev/ports.json and reused by
npm run dev and npm run dev:desktop.`);
  process.exit(0);
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

process.env.REDUX_FRONTEND_PORT = String(ports.frontendPort);
const frontendOrigins = [
  `http://127.0.0.1:${ports.frontendPort}`,
  `http://localhost:${ports.frontendPort}`,
];
process.env.REDUX_SERVER_ORIGINS = [process.env.REDUX_SERVER_ORIGINS, ...frontendOrigins]
  .filter(Boolean)
  .join(",");
process.env.REDUX_BACKEND_PORT = String(ports.backendPort);
process.env.REDUX_AI_PORT = String(ports.aiPort);
process.env.REDUX_COLLAB_PORT = String(ports.collabPort);

// The sidecar trusts the Vite origin only in this development loop. A packaged
// build never receives this environment variable.
process.env.REDUX_SERVER_DEV = "1";
await prepareDesktopPrerequisites(root);
runTauri(root, [
  "dev",
  "--config",
  JSON.stringify({ build: { devUrl: `http://127.0.0.1:${ports.frontendPort}` } }),
]);
