/**
 * End-to-end room crypto.
 *
 * The room server relays opaque AES-GCM envelopes and never receives the room
 * key. Encrypted rooms therefore trade server-side conflict inspection for
 * client-side last-writer-wins ordering; the wire guard stays dependency-free so
 * both the browser client and the Node room server can share it.
 */

const E2E_VERSION = 1;
const E2E_ALGORITHM = "AES-GCM";
const E2E_AAD_TEXT = "rpe-redux-collaboration-e2e-v1";
const E2E_KEY_BYTES = 32;
const E2E_IV_BYTES = 12;

/** Copy into a fresh ArrayBuffer so Web Crypto accepts the value as BufferSource. */
function e2eBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

const E2E_AAD = e2eBuffer(new TextEncoder().encode(E2E_AAD_TEXT));

/** Versioned AES-GCM envelope relayed by the room server. */
export interface EncryptedPayload {
  readonly v: 1;
  readonly alg: "AES-GCM";
  readonly iv: string;
  readonly data: string;
}

/** Encode bytes as unpadded base64url. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decode unpadded base64url into bytes. */
function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** A fresh 256-bit room key suitable for the invite's separate key field. */
export function createRoomKey(): string {
  const bytes = new Uint8Array(E2E_KEY_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Normalize and validate a key entered by a person. */
export function normalizeRoomKey(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const bytes = base64UrlDecode(trimmed);
    return bytes.byteLength === E2E_KEY_BYTES ? base64UrlEncode(bytes) : null;
  } catch {
    return null;
  }
}

/** Import a normalized room key for AES-GCM encryption and decryption. */
export async function importRoomKey(encoded: string): Promise<CryptoKey> {
  const bytes = base64UrlDecode(encoded);
  if (bytes.byteLength !== E2E_KEY_BYTES) {
    throw new Error("Room key must be 32 bytes");
  }
  return globalThis.crypto.subtle.importKey("raw", e2eBuffer(bytes), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Narrow an arbitrary wire value to a well-formed encrypted envelope. */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.v === E2E_VERSION &&
    record.alg === E2E_ALGORITHM &&
    typeof record.iv === "string" &&
    record.iv.length > 0 &&
    typeof record.data === "string" &&
    record.data.length > 0
  );
}

/** Encrypt bytes into a fresh-IV JSON envelope. */
export async function encryptEnvelopeBytes(
  key: CryptoKey,
  bytes: Uint8Array,
): Promise<EncryptedPayload> {
  const iv = new Uint8Array(E2E_IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: e2eBuffer(iv), additionalData: E2E_AAD },
    key,
    e2eBuffer(bytes),
  );
  return {
    v: E2E_VERSION,
    alg: E2E_ALGORITHM,
    iv: base64UrlEncode(iv),
    data: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

/** Decrypt one envelope into its bytes; throws when malformed or unauthentic. */
export async function decryptEnvelopeBytes(
  key: CryptoKey,
  payload: EncryptedPayload,
): Promise<Uint8Array> {
  if (!isEncryptedPayload(payload)) {
    throw new Error("Encrypted payload is malformed");
  }
  const iv = base64UrlDecode(payload.iv);
  const ciphertext = base64UrlDecode(payload.data);
  return new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: e2eBuffer(iv), additionalData: E2E_AAD },
      key,
      e2eBuffer(ciphertext),
    ),
  );
}

/** Encrypt a JSON value into a fresh-IV envelope. */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedPayload> {
  return encryptEnvelopeBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}

/** Decrypt and parse one JSON envelope; throws when malformed or unauthentic. */
export async function decryptJson(key: CryptoKey, payload: EncryptedPayload): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await decryptEnvelopeBytes(key, payload)));
}

/** Encrypt one asset into `iv || ciphertext` so the server can hash/store it. */
export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  const iv = new Uint8Array(E2E_IV_BYTES);
  globalThis.crypto.getRandomValues(iv);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: e2eBuffer(iv), additionalData: E2E_AAD },
      key,
      e2eBuffer(bytes),
    ),
  );
  const output = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  output.set(iv, 0);
  output.set(ciphertext, iv.byteLength);
  return output;
}

/** Decrypt `iv || ciphertext` bytes written by `encryptBytes`. */
export async function decryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.byteLength <= E2E_IV_BYTES) {
    throw new Error("Encrypted asset is too short");
  }
  const iv = bytes.subarray(0, E2E_IV_BYTES);
  const ciphertext = bytes.subarray(E2E_IV_BYTES);
  return new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: e2eBuffer(iv), additionalData: E2E_AAD },
      key,
      e2eBuffer(ciphertext),
    ),
  );
}

/** A changed plaintext chart array must look like changes before it is applied. */
export function isChangeList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}
