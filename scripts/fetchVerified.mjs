/**
 * Downloads release artifacts for desktop builds: verifies the SHA-256 of every
 * byte, reports progress while a large archive arrives, and retries transient
 * HTTP failures, because packaging mirrors rate-limit concurrent CI jobs with
 * 5xx responses.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, renameSync, rmSync } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Format a byte count for a progress line. */
function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Report download progress for transfers large enough that a slow link would
 * otherwise look like a hang.
 *
 * A transfer only reports while it is still arriving: one line every five
 * seconds once five percent more of the file has been received, plus one line
 * when it finishes. Small artifacts stay silent so build logs and tests remain
 * readable.
 *
 * @param {string} label Human-readable artifact name used in messages.
 * @param {number | null} total Expected size from `content-length`, if the server sent one.
 * @returns {Transform} Pass-through stream that counts bytes.
 */
function progressReporter(label, total) {
  const started = Date.now();
  let received = 0;
  let lastReport = started;
  let lastPercent = -5;
  const report = (final) => {
    const elapsed = Math.max(1, (Date.now() - started) / 1_000);
    const rate = received / elapsed;
    const percent = total ? Math.floor((received / total) * 100) : null;
    const size = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received);
    const suffix = percent === null ? "" : ` (${percent}%)`;
    console.log(
      `${final ? "Downloaded" : "Downloading"} ${label}: ${size}${suffix}, ${formatBytes(rate)}/s`,
    );
  };
  return new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      const now = Date.now();
      const percent = total ? Math.floor((received / total) * 100) : null;
      const advanced = percent === null || percent >= lastPercent + 5;
      const large = Math.max(total ?? 0, received) > 1_000_000;
      if (now - lastReport >= 5_000 && advanced && large) {
        lastReport = now;
        lastPercent = percent ?? lastPercent;
        report(false);
      }
      callback(null, chunk);
    },
    flush(callback) {
      if (received > 1_000_000) {
        report(true);
      }
      callback();
    },
  });
}

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
 * @param {string} options.url Absolute download URL of the published artifact.
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
      const total = Number(response.headers.get("content-length")) || null;
      await pipeline(
        Readable.fromWeb(response.body),
        progressReporter(label, total),
        createWriteStream(partial),
      );
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
