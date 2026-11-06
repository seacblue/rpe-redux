/** Pinned artifact downloads verify their checksum and survive transient HTTP failures. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { downloadVerifiedFile, hashFile } from "../../scripts/fetchVerified.mjs";

const payload = Buffer.from("pinned artifact payload");
const payloadHash = createHash("sha256").update(payload).digest("hex");

/** Serve scripted responses in order; a missing script repeats the last response. */
async function serve(responses) {
  const state = { requests: 0 };
  const server = createServer((request, response) => {
    const scripted = responses[Math.min(state.requests, responses.length - 1)];
    state.requests += 1;
    if (scripted.status) {
      response.writeHead(scripted.status);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(scripted.body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/artifact`,
    requests: () => state.requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("a rate-limited response is retried until the artifact verifies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "redux-fetch-test-"));
  const server = await serve([{ status: 503 }, { body: payload }]);
  try {
    const destination = join(dir, "artifact.bin");
    await downloadVerifiedFile({
      url: server.url,
      destination,
      expectedHash: payloadHash,
      label: "artifact",
      baseDelayMs: 5,
    });
    assert.deepEqual(readFileSync(destination), payload);
    assert.equal(await hashFile(destination), payloadHash);
    assert.equal(server.requests(), 2);
    assert.equal(existsSync(`${destination}.partial`), false);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt transfer never reaches the destination unchecked", async () => {
  const dir = mkdtempSync(join(tmpdir(), "redux-fetch-test-"));
  const server = await serve([{ body: Buffer.from("truncated") }, { body: payload }]);
  try {
    const destination = join(dir, "artifact.bin");
    await downloadVerifiedFile({
      url: server.url,
      destination,
      expectedHash: payloadHash,
      label: "artifact",
      baseDelayMs: 5,
    });
    assert.deepEqual(readFileSync(destination), payload);
    assert.equal(server.requests(), 2);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exhausted retries reject and leave no partial file behind", async () => {
  const dir = mkdtempSync(join(tmpdir(), "redux-fetch-test-"));
  const server = await serve([{ status: 503 }]);
  try {
    const destination = join(dir, "artifact.bin");
    await assert.rejects(
      downloadVerifiedFile({
        url: server.url,
        destination,
        expectedHash: payloadHash,
        label: "artifact",
        attempts: 2,
        baseDelayMs: 5,
      }),
      /artifact download failed: 503/,
    );
    assert.equal(server.requests(), 2);
    assert.equal(existsSync(destination), false);
    assert.equal(existsSync(`${destination}.partial`), false);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
