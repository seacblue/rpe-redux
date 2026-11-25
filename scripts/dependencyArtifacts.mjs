/** Resolve release-only third-party desktop artifacts without storing versions in the repository. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Manifest location below the repository root. */
const MANIFEST_PATH = join("scripts", "dependencySources.json");

/** GitHub's public API endpoint used only by release staging. */
const GITHUB_API = "https://api.github.com";

/** Platforms the source manifest must describe for the supported desktop targets. */
const FFMPEG_TARGETS = ["windows-x64", "windows-x86", "linux-x64"];

/** Cloudflare Tunnel assets the supported desktop targets download. */
const CLOUDFLARED_TARGETS = ["windows-amd64", "windows-386", "linux-amd64"];

/** Format a byte count for a build message. */
export function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Read one required non-empty string from a source entry. */
function requireText(entry, field, label) {
  const value = entry?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} needs a non-empty ${field}.`);
  }
  return value;
}

/** Validate a regular expression stored in the source manifest. */
function requirePattern(entry, field, label) {
  const value = requireText(entry, field, label);
  try {
    new RegExp(value, "u");
  } catch (error) {
    throw new Error(`${label} has an invalid ${field}.`, { cause: error });
  }
  return value;
}

/** Validate one GitHub repository name. */
function requireRepository(entry, label) {
  const repository = requireText(entry, "repository", label);
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    throw new Error(`${label} needs a GitHub repository in owner/name form.`);
  }
  return repository;
}

/** Validate the unversioned release source manifest. */
export function validateDependencySources(manifest, label = MANIFEST_PATH) {
  if (manifest?.schemaVersion !== 1) {
    throw new Error(`${label} must declare schemaVersion 1.`);
  }
  for (const target of FFMPEG_TARGETS) {
    const entry = manifest.ffmpeg?.[target];
    const entryLabel = `${label} FFmpeg ${target}`;
    if (!entry) {
      throw new Error(`${label} has no FFmpeg source for ${target}.`);
    }
    requireRepository(entry, entryLabel);
    requirePattern(entry, "assetPattern", entryLabel);
    requireText(entry, "licenseFile", entryLabel);
    if (entry.readmeFile !== null && typeof entry.readmeFile !== "string") {
      throw new Error(`${entryLabel} needs readmeFile as a string or null.`);
    }
    if (entry.selection !== "first" && entry.selection !== "highest-version") {
      throw new Error(`${entryLabel} needs selection first or highest-version.`);
    }
  }

  const cloudflaredLabel = `${label} cloudflared`;
  requireRepository(manifest.cloudflared, cloudflaredLabel);
  for (const target of CLOUDFLARED_TARGETS) {
    const entry = manifest.cloudflared?.assets?.[target];
    const entryLabel = `${cloudflaredLabel} ${target}`;
    if (!entry) {
      throw new Error(`${cloudflaredLabel} has no source for ${target}.`);
    }
    requireText(entry, "name", entryLabel);
  }
  return manifest;
}

/** Read and validate the checked-in release source manifest. */
export function loadDependencySources(root) {
  const path = join(root, MANIFEST_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`, { cause: error });
  }
  return validateDependencySources(parsed, path);
}

/** Select the source entry for one FFmpeg target. */
export function selectFfmpegSource(sources, platform, arch) {
  const entry = sources?.ffmpeg?.[`${platform}-${arch}`];
  if (!entry) {
    throw new Error(`The dependency sources have no FFmpeg build for ${platform}/${arch}.`);
  }
  return entry;
}

/** Select the source entry for one Cloudflare Tunnel target. */
export function selectCloudflaredSource(sources, platform, architecture) {
  const entry = sources?.cloudflared?.assets?.[`${platform}-${architecture}`];
  if (!entry) {
    throw new Error(
      `The dependency sources have no Cloudflare Tunnel client for ${platform}/${architecture}.`,
    );
  }
  return entry;
}

/** Compare the first dotted numeric version embedded in an asset name. */
function compareEmbeddedVersions(left, right) {
  const read = (name) => name.match(/(?:^|[^\d])v?(\d+(?:\.\d+)+)(?:[^\d]|$)/u)?.[1] ?? "0";
  const leftParts = read(left).split(".").map(Number);
  const rightParts = read(right).split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.localeCompare(right);
}

/** Select a release asset from a source rule without knowing its future name. */
export function selectReleaseAsset(release, source, label) {
  if (!Array.isArray(release?.assets)) {
    throw new Error(`${label} latest release has no assets.`);
  }
  const pattern = new RegExp(source.assetPattern, "u");
  const candidates = release.assets.filter(
    (asset) => typeof asset?.name === "string" && pattern.test(asset.name),
  );
  if (candidates.length === 0) {
    throw new Error(`${label} latest release has no asset matching ${source.assetPattern}.`);
  }
  if (source.selection === "highest-version") {
    candidates.sort((left, right) => compareEmbeddedVersions(right.name, left.name));
  }
  const asset = candidates[0];
  if (asset.name.includes("/") || asset.name.includes("\\")) {
    throw new Error(`${label} latest asset ${asset.name} is not a plain file name.`);
  }
  if (
    typeof asset.browser_download_url !== "string" ||
    !asset.browser_download_url.startsWith("https://")
  ) {
    throw new Error(`${label} latest asset ${asset.name} has no HTTPS download URL.`);
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`${label} latest asset ${asset.name} has no positive size.`);
  }
  return asset;
}

/** Select a named release asset for a Cloudflare Tunnel target. */
export function selectNamedReleaseAsset(release, name, label) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return selectReleaseAsset(release, { assetPattern: `^${escaped}$`, selection: "first" }, label);
}

/** Parse GitHub's optional asset digest into the format the downloader expects. */
function assetDigest(asset) {
  const digest = asset?.digest;
  if (typeof digest !== "string") {
    return null;
  }
  const match = /^sha256:([0-9a-f]{64})$/u.exec(digest);
  if (!match) {
    throw new Error(`GitHub returned an unsupported digest for ${asset.name}.`);
  }
  return match[1];
}

/** Fetch the latest stable GitHub release for a repository. */
export async function fetchLatestRelease(repository, fetchImpl = fetch) {
  const response = await fetchImpl(`${GITHUB_API}/repos/${repository}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "RPE-Redux-release-resolver",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub latest release lookup failed for ${repository}: ${response.status}.`);
  }
  const release = await response.json();
  if (!release?.tag_name || !release.html_url) {
    throw new Error(`GitHub returned an invalid latest release for ${repository}.`);
  }
  return release;
}

/** Build the resolved metadata shared by the two staging scripts. */
function resolvedArtifact(release, asset, source) {
  return {
    releaseTag: release.tag_name,
    releaseName: release.name ?? release.tag_name,
    releaseUrl: release.html_url,
    publishedAt: release.published_at ?? null,
    provider: source.repository,
    archiveName: asset.name,
    archiveUrl: asset.browser_download_url,
    size: asset.size,
    sha256: assetDigest(asset),
    licenseFile: source.licenseFile ?? null,
    readmeFile: source.readmeFile ?? null,
  };
}

/** Resolve the latest FFmpeg archive for a target. */
export async function resolveLatestFfmpeg(sources, platform, arch, fetchImpl = fetch) {
  const source = selectFfmpegSource(sources, platform, arch);
  const release = await fetchLatestRelease(source.repository, fetchImpl);
  const asset = selectReleaseAsset(release, source, `FFmpeg ${platform}/${arch}`);
  return resolvedArtifact(release, asset, source);
}

/** Resolve the latest Cloudflare Tunnel executable for a target. */
export async function resolveLatestCloudflared(sources, platform, architecture, fetchImpl = fetch) {
  const source = sources.cloudflared;
  const target = selectCloudflaredSource(sources, platform, architecture);
  const release = await fetchLatestRelease(source.repository, fetchImpl);
  const asset = selectNamedReleaseAsset(
    release,
    target.name,
    `Cloudflare Tunnel ${platform}/${architecture}`,
  );
  return resolvedArtifact(release, asset, source);
}

/** Locate the archive root that holds `bin/<binary>`. */
export function findArchiveRoot(entries, binary) {
  const suffix = `/bin/${binary}`;
  const binaryEntry = entries.find((entry) => entry.endsWith(suffix));
  if (!binaryEntry) {
    throw new Error(`The downloaded archive does not contain bin/${binary}.`);
  }
  return { root: binaryEntry.slice(0, -suffix.length), binaryEntry };
}
