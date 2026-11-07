/**
 * Runs the desktop development loop: stage the native prerequisites once, then
 * hand the window and the Vite server to the Tauri CLI.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareDesktopPrerequisites } from "./desktopPrerequisites.mjs";
import { desktopPortArgument } from "./desktopLaunchOptions.mjs";
import { runTauri } from "./tauriCli.mjs";

const root = resolve(import.meta.dirname, "..");

/** Read the next-launch frontend port from the same profile file as Tauri. */
async function configuredFrontendPort() {
  const candidates = [];
  if (process.env.REDUX_PROFILE_DIR) {
    candidates.push(resolve(process.env.REDUX_PROFILE_DIR, "runtime-ports.json"));
  }
  candidates.push(resolve(root, "src-tauri", "target", "debug", "user-data", "runtime-ports.json"));
  candidates.push(resolve(root, "user-data", "runtime-ports.json"));
  for (const path of candidates) {
    try {
      const value = JSON.parse(await readFile(path, "utf8"));
      if (
        Number.isInteger(value.frontendPort) &&
        value.frontendPort >= 1 &&
        value.frontendPort <= 65535
      ) {
        return value.frontendPort;
      }
    } catch {
      // A missing or partially written settings file uses the product default.
    }
  }
  return 4173;
}

const frontendPort =
  desktopPortArgument(process.argv.slice(2), "frontend") ?? (await configuredFrontendPort());
const backendPort = desktopPortArgument(process.argv.slice(2), "backend");
const aiPort = desktopPortArgument(process.argv.slice(2), "ai");
process.env.REDUX_FRONTEND_PORT = String(frontendPort);
const frontendOrigins = [`http://127.0.0.1:${frontendPort}`, `http://localhost:${frontendPort}`];
process.env.REDUX_SERVER_ORIGINS = [process.env.REDUX_SERVER_ORIGINS, ...frontendOrigins]
  .filter(Boolean)
  .join(",");
if (backendPort !== undefined) {
  process.env.REDUX_BACKEND_PORT = String(backendPort);
}
if (aiPort !== undefined) {
  process.env.REDUX_AI_PORT = String(aiPort);
}

// The sidecar trusts the Vite origin only in this development loop. A packaged
// build never receives this environment variable.
process.env.REDUX_SERVER_DEV = "1";
await prepareDesktopPrerequisites(root);
runTauri(root, [
  "dev",
  "--config",
  JSON.stringify({ build: { devUrl: `http://127.0.0.1:${frontendPort}` } }),
]);
