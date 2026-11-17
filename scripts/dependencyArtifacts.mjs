/**
 * Resolves the newest upstream release of a bundled desktop dependency and
 * verifies it against the checksum its publisher ships.
 *
 * The desktop build stages FFmpeg and the Cloudflare Tunnel client; both come
 * from release feeds that rotate, so the version, the asset name, and the
 * expected digest are read from the vendor at build time instead of being
 * pinned in this checkout. The staging scripts own their platform layout; this
 * module owns the feed parsing, the asset selection, and the verification rules
 * they share.
 */
import { downloadVerifiedFile } from "./fetchVerified.mjs";

/** Identify this build in vendor request logs. */
const USER_AGENT = "rpe-redux-build";

/** Share the verified download between the staging scripts and their callers. */
export { downloadVerifiedFile };

/**
 * Fetch a small text document, retrying transient HTTP failures.
 *
 * The release feeds answer from a CDN and occasionally return 5xx or drop a
 * connection, so a failed attempt is retried with exponential backoff plus
 * jitter before the caller decides that the feed is unreachable.
 *
 * @param {string} url Absolute HTTP(S) URL.
 * @param {object} options
 * @param {string} options.label Human-readable artifact name used in messages.
 * @param {number} [options.attempts] Total attempts, including the first one.
 * @param {number} [options.baseDelayMs] First backoff step; later attempts double it.
 * @param {Record<string, string>} [options.headers] Extra request headers.
 * @returns {Promise<string>} Response body decoded as UTF-8.
 */
export async function fetchText(
  url,
  { label, attempts = 3, baseDelayMs = 2_000, headers = {} } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        redirect: "follow",
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`${label} request returned HTTP ${response.status}.`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        break;
      }
      const delayMs =
        baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * (baseDelayMs / 2));
      console.log(
        `${label}: attempt ${attempt} of ${attempts} failed (${error.message}); ` +
          `retrying in ${Math.round(delayMs / 1_000)}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

/**
 * Fetch one GitHub API document.
 *
 * An unauthenticated request is enough for one release lookup per build; when
 * the environment carries a token the request uses it so a rate-limited
 * unauthenticated pool cannot fail the packaging job.
 *
 * @param {string} url Absolute GitHub API URL.
 * @param {string} label Human-readable feed name used in messages.
 * @returns {Promise<Record<string, unknown>>} Parsed response body.
 */
export async function fetchGitHubJson(url, label) {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  const body = await fetchText(url, {
    label,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${label} returned a response that is not JSON.`);
  }
}

/**
 * Read the size a server advertises for one artifact.
 *
 * Check mode uses this to say how large the download would be without
 * transferring the file. A server that rejects the HEAD request, or omits the
 * length, reports `null` rather than failing the check.
 *
 * @param {string} url Absolute HTTP(S) URL.
 * @param {object} [options]
 * @param {string} [options.label] Human-readable artifact name used in messages.
 * @returns {Promise<number | null>} Content length in bytes, or null.
 */
export async function fetchContentLength(url, { label = "artifact" } = {}) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      console.log(`${label}: HEAD request returned HTTP ${response.status}.`);
      return null;
    }
    const length = Number(response.headers.get("content-length"));
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch (error) {
    console.log(`${label}: HEAD request failed (${error.message}).`);
    return null;
  }
}

/** Format a byte count for a build message. */
export function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Read the release version a vendor endpoint publishes.
 *
 * @param {string} text Response body, for example `9.0.2`.
 * @param {string} label Human-readable feed name used in messages.
 * @returns {string} Version in `major.minor` or `major.minor.patch` form.
 */
export function parseVersion(text, label) {
  const version = text.trim();
  if (!/^\d+\.\d+(?:\.\d+)?$/u.test(version)) {
    throw new Error(`${label} returned an unexpected version: ${JSON.stringify(version)}.`);
  }
  return version;
}

/**
 * Read one bare SHA-256 digest, such as the `.sha256` file gyan.dev publishes.
 *
 * @param {string} text Response body holding one hexadecimal digest.
 * @param {string} label Human-readable feed name used in messages.
 * @returns {string} Lowercase 64-character digest.
 */
export function parseDigest(text, label) {
  const digest = text.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(
      `${label} returned an unexpected checksum: ${JSON.stringify(text.trim().slice(0, 80))}.`,
    );
  }
  return digest;
}

/**
 * Parse a `sha256sum`-style checksum file into asset name to digest.
 *
 * Both FFmpeg publishers ship one line per artifact as `<digest>  <name>`; the
 * optional `*` that marks binary mode is accepted, and comment or malformed
 * lines are ignored rather than guessed at.
 *
 * @param {string} text Checksum file contents.
 * @returns {Map<string, string>} Asset name to lowercase SHA-256 digest.
 */
export function parseChecksums(text) {
  const checksums = new Map();
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([0-9a-fA-F]{64})\s+\*?(\S.*?)\s*$/u.exec(line);
    if (match?.[1] && match[2]) {
      checksums.set(match[2], match[1].toLowerCase());
    }
  }
  return checksums;
}

/**
 * Pick the newest release-branch artifact from one publisher's asset names.
 *
 * `pattern` captures the numeric branch twice, for example
 * `ffmpeg-n9.0-latest-linux64-gpl-9.0.tar.xz`, so a name that pairs two
 * different branches is rejected instead of being guessed at.
 *
 * @param {Iterable<string>} names Asset names published by the feed.
 * @param {RegExp} pattern Non-global pattern whose two captures are the branch.
 * @param {string} label Human-readable build name used in messages.
 * @returns {{name: string, branch: string}} Newest matching asset.
 */
export function selectNewestBranch(names, pattern, label) {
  let best = null;
  for (const name of names) {
    const match = pattern.exec(name);
    if (!match) {
      continue;
    }
    const [branch, alias = branch] = match.slice(1);
    if (branch !== alias) {
      continue;
    }
    const [major, minor] = branch.split(".").map(Number);
    if (!best || major > best.major || (major === best.major && minor > best.minor)) {
      best = { name, branch, major, minor };
    }
  }
  if (best === null) {
    throw new Error(`No ${label} asset matches the expected name pattern.`);
  }
  return { name: best.name, branch: best.branch };
}

/**
 * Return the download URL and published digest of one GitHub release asset.
 *
 * GitHub publishes a SHA-256 digest for every asset it hosts; requiring it
 * keeps a dependency download verified even when the publisher ships no
 * checksum file of its own.
 *
 * @param {Record<string, unknown>} release GitHub release document.
 * @param {string} name Exact asset file name.
 * @returns {{url: string, digest: string, size: number}} Download target.
 */
export function selectReleaseAsset(release, name) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find((entry) => entry?.name === name);
  if (!asset) {
    throw new Error(`Release ${release?.tag_name ?? "unknown"} does not publish ${name}.`);
  }
  const digest = /^sha256:([0-9a-f]{64})$/u.exec(asset.digest ?? "")?.[1];
  if (!digest) {
    throw new Error(`Release ${release.tag_name} publishes no SHA-256 digest for ${name}.`);
  }
  if (typeof asset.browser_download_url !== "string") {
    throw new Error(`Release ${release.tag_name} publishes no download URL for ${name}.`);
  }
  return { url: asset.browser_download_url, digest, size: Number(asset.size ?? 0) };
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
