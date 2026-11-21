/**
 * Byte-level fingerprints for Extension packages and built-in trust matching.
 *
 * Consent is bound to the exact reviewed bytes. Built-in trust uses a canonical
 * JSON envelope so the source tree, Vite bundle and installed resource folder
 * produce the same digest even when their whitespace differs.
 */

/**
 * Built-in ids selected for automatic first-launch enablement.
 *
 * This is only an enablement policy. Trust is granted separately by matching
 * the shipped version and content fingerprint; an id alone never verifies a
 * package.
 */
export const DEFAULT_ENABLED_BUILTIN_IDS = new Set(["builtin.official"]);

/** The content facts required before a package can be treated as shipped. */
export interface BuiltinTrustRecord {
  version: string;
  fingerprint: string;
}

/** Match shipped content, never just the package id. */
export function matchesBuiltinTrust(
  expected: BuiltinTrustRecord | undefined,
  version: string,
  fingerprint: string,
): boolean {
  return expected?.version === version && expected.fingerprint === fingerprint;
}

/** Encodes a package text part as bytes; undefined becomes empty. */
function bytesOf(value: string | ArrayLike<number> | undefined): Uint8Array {
  if (value === undefined) {
    return new Uint8Array();
  }
  if (typeof value === "string") {
    return new TextEncoder().encode(value);
  }
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

/** Hash one length-prefixed sequence of byte parts. */
async function hashParts(parts: readonly Uint8Array[]): Promise<string> {
  // Length-prefix every part. Concatenating variable-length byte runs without
  // boundaries makes the digest ambiguous even before a package grows files.
  const header = new Uint8Array(parts.length * 4);
  const headerView = new DataView(header.buffer);
  let total = header.byteLength;
  parts.forEach((part, index) => {
    headerView.setUint32(index * 4, part.byteLength);
    total += part.byteLength;
  });
  const input = new Uint8Array(total);
  input.set(header);
  let offset = header.byteLength;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.byteLength;
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Computes the review fingerprint from package bytes, never from the extension id. */
export async function extensionFingerprint(
  manifest: string,
  translations: string | undefined,
  entry: string | ArrayLike<number> | undefined,
  assetsDigest?: string,
): Promise<string> {
  return hashParts([
    bytesOf(manifest),
    bytesOf(translations),
    bytesOf(entry),
    ...(assetsDigest === undefined ? [] : [bytesOf(assetsDigest)]),
  ]);
}

/** Hash every declared asset name, path, and byte run in a stable order. */
export async function assetDigest(
  assets: readonly { readonly name: string; readonly path?: string; readonly bytes: Uint8Array }[],
): Promise<string> {
  const parts: Uint8Array[] = [];
  for (const asset of [...assets].sort((left, right) => left.name.localeCompare(right.name))) {
    parts.push(bytesOf(asset.name), bytesOf(asset.path ?? ""), asset.bytes);
  }
  return hashParts(parts);
}

/**
 * Canonical JSON used by the built-in trust digest. Package files may be
 * pretty-printed differently in the source tree, the Vite bundle, and the
 * installed resource root; the trust decision must not depend on whitespace or
 * object key order.
 */
function stableJson(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

/** The trust digest of a package independent of file formatting. */
export async function builtinTrustFingerprint(
  manifest: unknown,
  translations: unknown,
  entry: string | undefined,
  assetsDigest?: string,
): Promise<string> {
  return extensionFingerprint(
    stableJson(manifest),
    translations === undefined ? undefined : stableJson(translations),
    entry,
    assetsDigest,
  );
}
