/** Read and validate the one product version shared by every desktop build input. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Read a JSON version field from a repository build manifest. */
function jsonVersion(path) {
  const value = JSON.parse(readFileSync(path, "utf8")).version;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing product version in ${path}.`);
  }
  return value.trim();
}

/** Read the package version from Cargo.toml. */
function cargoVersion(path) {
  const source = readFileSync(path, "utf8");
  const match = /^version\s*=\s*"([^"]+)"/mu.exec(source);
  if (!match) {
    throw new Error(`Missing product version in ${path}.`);
  }
  return match[1];
}

/**
 * Read the product version and fail before a build can mix frontend, host, and
 * sidecar versions. All callers use this same source-of-truth check.
 */
export function readProductVersion(root = resolve(import.meta.dirname, "..")) {
  const versions = {
    package: jsonVersion(join(root, "package.json")),
    tauri: jsonVersion(join(root, "src-tauri", "tauri.conf.json")),
    cargo: cargoVersion(join(root, "src-tauri", "Cargo.toml")),
  };
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    throw new Error(
      `Product version mismatch: ${Object.entries(versions)
        .map(([name, version]) => `${name}=${version}`)
        .join(", ")}. Update all desktop version manifests together.`,
    );
  }
  return versions.package;
}
