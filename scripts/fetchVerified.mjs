/**
 * Downloads pinned release artifacts for desktop builds: verifies the SHA-256
 * of every byte and retries transient HTTP failures, because packaging mirrors
 * rate-limit concurrent CI jobs with 5xx responses.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, renameSync, rmSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Stream a file through SHA-256 and return the lowercase hex digest. */
export async function hashFile(path) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    digest.update(chunk);
  }
  return digest.digest("hex");
}

/**
 * Download `url` to `destination` until the file hashes to `expectedHash`.
 *
 * Transient failures (5xx responses, dropped connections, timeouts, and
 * checksum mismatches from a truncated transfer) are retried with exponential
 * backoff plus jitter so the concurrent release jobs do not retry in lockstep.
 * The partial file never survives a failed attempt, and the destination is only
 * replaced after verification.
 *
 * @param {object} options
 * @param {string} options.url Pinned download URL.
 * @param {string} options.destination Final file path.
 * @param {string} options.expectedHash Lowercase SHA-256 hex digest to enforce.
 * @param {string} options.label Human-readable artifact name used in messages.
 * @param {number} [options.attempts] Total attempts, including the first one.
 * @param {number} [options.baseDelayMs] First backoff step; later attempts double it.
 */
export async function downloadVerifiedFile({
  url,
  destination,
  expectedHash,
  label,
  attempts = 4,
  baseDelayMs = 5_000,
}) {
  const partial = `${destination}.partial`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) {
        throw new Error(`${label} download failed: ${response.status}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
      if ((await hashFile(partial)) !== expectedHash) {
        throw new Error(`${label} download checksum mismatch.`);
      }
      renameSync(partial, destination);
      return;
    } catch (error) {
      rmSync(partial, { force: true });
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
