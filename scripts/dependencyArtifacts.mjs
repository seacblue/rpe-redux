/**
 * Reads the pinned manifest for the bundled desktop dependencies and holds the
 * helpers their staging scripts share.
 *
 * FFmpeg and the Cloudflare Tunnel client are pinned in `dependencyPins.json`
 * by exact version, immutable download URL, size, and SHA-256 digest. A build
 * reads that manifest instead of resolving a vendor's latest release, so a
 * verified pair is reused until a maintainer changes the pin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Manifest location below the repository root. */
const MANIFEST_PATH = join("scripts", "dependencyPins.json");

/** Platforms the manifest must describe for the supported desktop targets. */
const FFMPEG_TARGETS = ["windows-x64", "windows-x86", "linux-x64"];

/** Cloudflare Tunnel assets the supported desktop targets download. */
const CLOUDFLARED_TARGETS = ["windows-amd64", "windows-386", "linux-amd64"];

/** Format a byte count for a build message. */
export function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Read one required non-empty string from a pin entry. */
function requireText(entry, field, label) {
  const value = entry?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} needs a non-empty ${field}.`);
  }
  return value;
}

/** Read one positive integer byte count from a pin entry. */
function requireSize(entry, label) {
  const size = entry?.size;
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`${label} needs a positive size.`);
  }
  return size;
}

/** Read one lowercase SHA-256 digest from a pin entry. */
function requireDigest(entry, label) {
  const digest = requireText(entry, "sha256", label);
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`${label} needs a lowercase SHA-256 digest.`);
  }
  return digest;
}

/** Read one HTTPS URL whose file name matches the pinned artifact. */
function requireArtifactUrl(entry, urlField, nameField, label) {
  const url = requireText(entry, urlField, label);
  const name = requireText(entry, nameField, label);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} has an invalid ${urlField}.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must download over HTTPS.`);
  }
  if (parsed.pathname.split("/").pop() !== name) {
    throw new Error(`${label} URL does not name ${name}.`);
  }
  return { url, name };
}

/**
 * Validate one dependency pin manifest.
 *
 * Validation keeps a hand-edited manifest from silently pointing a build at a
 * different artifact: every target must carry a version, an HTTPS URL naming
 * the pinned file, a positive size, and a SHA-256 digest.
 *
 * @param {unknown} manifest Parsed `dependencyPins.json` document.
 * @param {string} [label] Manifest name used in error messages.
 * @returns {Record<string, any>} The same manifest, after validation.
 */
export function validateDependencyPins(manifest, label = MANIFEST_PATH) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error(`${label} must declare schemaVersion 1.`);
  }
  for (const target of FFMPEG_TARGETS) {
    const entry = manifest.ffmpeg?.[target];
    const entryLabel = `${label} FFmpeg ${target}`;
    if (!entry) {
      throw new Error(`${label} has no FFmpeg pin for ${target}.`);
    }
    requireText(entry, "version", entryLabel);
    requireText(entry, "label", entryLabel);
    requireText(entry, "provider", entryLabel);
    requireArtifactUrl(entry, "archiveUrl", "archiveName", entryLabel);
    requireDigest(entry, entryLabel);
    requireSize(entry, entryLabel);
    requireText(entry, "licenseFile", entryLabel);
    if (entry.readmeFile !== null && typeof entry.readmeFile !== "string") {
      throw new Error(`${entryLabel} needs readmeFile as a string or null.`);
    }
  }

  const cloudflaredLabel = `${label} cloudflared`;
  requireText(manifest.cloudflared, "version", cloudflaredLabel);
  requireText(manifest.cloudflared, "provider", cloudflaredLabel);
  for (const target of CLOUDFLARED_TARGETS) {
    const entry = manifest.cloudflared?.assets?.[target];
    const entryLabel = `${cloudflaredLabel} ${target}`;
    if (!entry) {
      throw new Error(`${cloudflaredLabel} has no asset for ${target}.`);
    }
    requireArtifactUrl(entry, "url", "name", entryLabel);
    requireDigest(entry, entryLabel);
    requireSize(entry, entryLabel);
  }
  return manifest;
}

/**
 * Read and validate the checked-in dependency pins.
 *
 * @param {string} root Repository root.
 * @returns {Record<string, any>} Validated manifest.
 */
export function loadDependencyPins(root) {
  const path = join(root, MANIFEST_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`, { cause: error });
  }
  return validateDependencyPins(parsed, path);
}

/**
 * Select the pinned FFmpeg distribution for one desktop target.
 *
 * @param {Record<string, any>} pins Validated manifest.
 * @param {string} platform `windows` or `linux`.
 * @param {string} arch `x64`, `x86`, or `arm64`.
 * @returns {Record<string, any>} Pinned distribution entry.
 */
export function selectFfmpegPin(pins, platform, arch) {
  const entry = pins?.ffmpeg?.[`${platform}-${arch}`];
  if (!entry) {
    throw new Error(`The dependency pins have no FFmpeg build for ${platform}/${arch}.`);
  }
  return entry;
}

/**
 * Select the pinned Cloudflare Tunnel client for one desktop target.
 *
 * @param {Record<string, any>} pins Validated manifest.
 * @param {string} platform `windows` or `linux`.
 * @param {string} architecture `amd64`, `386`, or `arm64`.
 * @returns {Record<string, any>} Pinned asset entry.
 */
export function selectCloudflaredPin(pins, platform, architecture) {
  const entry = pins?.cloudflared?.assets?.[`${platform}-${architecture}`];
  if (!entry) {
    throw new Error(
      `The dependency pins have no Cloudflare Tunnel client for ${platform}/${architecture}.`,
    );
  }
  return entry;
}

/**
 * Locate the archive root that holds `bin/<binary>`.
 *
 * Vendors wrap the executable in a versioned top-level folder whose name
 * changes with every release, so the folder is read from the archive listing
 * rather than rebuilt from the version string.
 *
 * @param {string[]} entries Archive listing entries.
 * @param {string} binary Executable file name inside `bin/`.
 * @returns {{root: string, binaryEntry: string}} Distribution folder and entry.
 */
export function findArchiveRoot(entries, binary) {
  const suffix = `/bin/${binary}`;
  const binaryEntry = entries.find((entry) => entry.endsWith(suffix));
  if (!binaryEntry) {
    throw new Error(`The downloaded archive does not contain bin/${binary}.`);
  }
  return { root: binaryEntry.slice(0, -suffix.length), binaryEntry };
}
