/** Build the Go service that the desktop executable embeds at compile time. */
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readProductVersion } from "../../scripts/productVersion.mjs";

const backend = dirname(fileURLToPath(import.meta.url));
const productVersion = readProductVersion(resolve(backend, "../.."));
const rust = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
if (rust.error || rust.status !== 0) {
  throw new Error(rust.error?.message ?? rust.stderr);
}
const target = process.env.CARGO_BUILD_TARGET ?? /^host: (.+)$/m.exec(rust.stdout)?.[1];
if (!target) {
  throw new Error("Cannot determine the Rust target for the sidecar.");
}
const architecture = {
  x86_64: "amd64",
  aarch64: "arm64",
  i686: "386",
}[target.split("-")[0]];
const platform = target.includes("windows")
  ? "windows"
  : target.includes("apple")
    ? "darwin"
    : target.includes("linux")
      ? "linux"
      : undefined;
if (!architecture || !platform) {
  throw new Error(`Unsupported sidecar target: ${target}`);
}
const directory = resolve(backend, "../../src-tauri/resources");
mkdirSync(directory, { recursive: true });
for (const entry of readdirSync(directory)) {
  if (entry.startsWith("rpe-redux-server") || entry.startsWith("redux-service")) {
    unlinkSync(resolve(directory, entry));
  }
}
const binary = resolve(directory, "redux-service");
const result = spawnSync(
  "go",
  [
    "build",
    "-trimpath",
    `-ldflags=-s -w -X main.version=${productVersion}`,
    "-o",
    binary,
    "./cmd/redux-service",
  ],
  {
    cwd: backend,
    env: { ...process.env, GOOS: platform, GOARCH: architecture, CGO_ENABLED: "0" },
    stdio: "inherit",
  },
);
if (result.error) {
  throw result.error;
}
if (result.status === 0 && platform === "windows") {
  copyFileSync(binary, resolve(directory, "redux-service.exe"));
}
process.exitCode = result.status ?? 1;
