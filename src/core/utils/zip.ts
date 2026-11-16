/**
 * Minimal ZIP reading and writing for PEZ archives.
 *
 * Provides CRC32, bounded entry reads with caller-supplied limits, and blob output
 * built in memory.
 */
import { t } from "../../i18n/index.ts";
import { toBlobPart } from "./bytes.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ZIP64_MARKER = 0xffffffff;
const crcTable = Uint32Array.from({ length: 256 }, (unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/** CRC-32 (IEEE) of the complete byte range. */
export function crc32(bytes: Uint8Array): number {
  return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

/** Advance a CRC-32 state without applying the final XOR. */
function crc32Update(initial: number, bytes: Uint8Array): number {
  let crc = initial;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

/** Reject absolute, parent-traversing, and otherwise ambiguous entry names. */
function checkPath(name: string): void {
  if (
    !name ||
    name.startsWith("/") ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.includes(":") ||
    name.split("/").includes("..")
  ) {
    throw new Error(t("system.zip.unsafePath", { name }));
  }
}

/** Optional entry-count, byte-budget, and progress bounds for `readZip`. */
export interface ZipLimits {
  maxEntries?: number;
  maxTotalBytes?: number;
  maxEntryBytes?: number;
  /** Only decompress these entries; all central-directory entries remain validated. */
  only?: readonly string[];
  /** Select entries during one local read without exposing a cross-thread callback. */
  entryFilter?: (name: string) => boolean;
  /** Observe validated entry names without forcing their contents to be read. */
  onEntryName?: (name: string) => void;
  onProgress?: (completed: number, total: number) => void | Promise<void>;
}

/**
 * Read a ZIP archive into entry bytes, rejecting unsafe names, duplicate names,
 * ZIP64/encrypted archives, and any limit violation.
 */
export async function readZip(
  buffer: Uint8Array | ArrayBuffer,
  limits: ZipLimits = {},
): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let trailer = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (
      view.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + view.getUint16(offset + 20, true) === bytes.length
    ) {
      trailer = offset;
      break;
    }
  }
  if (trailer < 0) {
    throw new Error(t("system.zip.invalidDirectory"));
  }
  const count = view.getUint16(trailer + 10, true);
  if (count > (limits.maxEntries ?? Infinity)) {
    throw new Error(t("system.zip.tooManyEntries"));
  }
  if (
    view.getUint16(trailer + 4, true) ||
    view.getUint16(trailer + 6, true) ||
    count === 0xffff ||
    view.getUint32(trailer + 12, true) === ZIP64_MARKER ||
    view.getUint32(trailer + 16, true) === ZIP64_MARKER
  ) {
    throw new Error(t("system.zip.spannedUnsupported"));
  }
  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  const only = limits.only ? new Set(limits.only) : null;
  let offset = view.getUint32(trailer + 16, true);
  let totalSize = 0;
  await limits.onProgress?.(0, count);
  for (let index = 0; index < count; index++) {
    if (offset + 46 > trailer || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error(t("system.zip.damagedDirectory"));
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const checksum = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    totalSize += size;
    if (
      size > (limits.maxEntryBytes ?? Infinity) ||
      totalSize > (limits.maxTotalBytes ?? Infinity)
    ) {
      throw new Error(t("system.zip.sizeBudget"));
    }
    const nameSize = view.getUint16(offset + 28, true);
    const extraSize = view.getUint16(offset + 30, true);
    const commentSize = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (
      flags & 1 ||
      size === ZIP64_MARKER ||
      compressedSize === ZIP64_MARKER ||
      localOffset === ZIP64_MARKER
    ) {
      throw new Error(t("system.zip.encryptedUnsupported"));
    }
    if (offset + 46 + nameSize + extraSize + commentSize > trailer) {
      throw new Error(t("system.zip.nameOutOfBounds"));
    }
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + nameSize);
    const name = (flags & 0x800 ? decoder : new TextDecoder("gb18030")).decode(nameBytes);
    checkPath(name);
    limits.onEntryName?.(name);
    if (seen.has(name)) {
      throw new Error(t("system.zip.duplicateName", { name }));
    }
    seen.add(name);
    if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
      throw new Error(t("system.zip.headerDamaged"));
    }
    const dataOffset =
      localOffset +
      30 +
      view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    if (dataOffset + compressedSize > offset) {
      throw new Error(t("system.zip.contentOutOfBounds"));
    }
    if (method !== 0 && method !== 8) {
      throw new Error(t("system.zip.unsupportedCompression", { method }));
    }
    if ((only && !only.has(name)) || (limits.entryFilter && !limits.entryFilter(name))) {
      offset += 46 + nameSize + extraSize + commentSize;
      await limits.onProgress?.(index + 1, count);
      continue;
    }
    let contents: Uint8Array<ArrayBuffer>;
    if (method === 8) {
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
      const reader = new Blob([compressed])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
      contents = new Uint8Array(size);
      let length = 0;
      let crc = 0xffffffff;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        if (length + chunk.value.length > size) {
          await reader.cancel();
          throw new Error(t("system.zip.sizeMismatch"));
        }
        contents.set(chunk.value, length);
        crc = crc32Update(crc, chunk.value);
        length += chunk.value.length;
      }
      if (length !== size || (crc ^ 0xffffffff) >>> 0 !== checksum) {
        throw new Error(t("system.zip.checksumFailed", { name }));
      }
    } else {
      contents = bytes.slice(dataOffset, dataOffset + compressedSize);
    }
    if (contents.length !== size || (method === 0 && crc32(contents) !== checksum)) {
      throw new Error(t("system.zip.checksumFailed", { name }));
    }
    files.set(name, contents);
    offset += 46 + nameSize + extraSize + commentSize;
    await limits.onProgress?.(index + 1, count);
  }
  return files;
}

/**
 * What `writeZip` needs from its entries: a count plus iterable name/byte pairs.
 * A real `Map` satisfies both. The size guard rejects ZIP64 input before iteration.
 */
export type ZipEntrySource = ReadonlyMap<string, Uint8Array> | { readonly size: number };

/**
 * Build an uncompressed ZIP blob from named byte entries.
 *
 * Throws when a name is unsafe, the archive requires ZIP64, or an entry exceeds
 * a ZIP32 field.
 */
export function writeZip(files: ZipEntrySource): Blob {
  if (files.size >= 0xffff) {
    throw new Error(t("system.zip.entryCountNeedsZip64"));
  }
  // Read the guarded source as an entry map; the count check above bounds the trailer.
  const entries = files as ReadonlyMap<string, Uint8Array>;
  const records: Uint8Array<ArrayBuffer>[] = [];
  const directories: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const [name, contents] of entries) {
    checkPath(name);
    const nameBytes = encoder.encode(name);
    if (nameBytes.length > 65535) {
      throw new Error(t("system.zip.nameTooLong"));
    }
    if (
      contents.length >= ZIP64_MARKER ||
      offset + 30 + nameBytes.length + contents.length >= ZIP64_MARKER
    ) {
      throw new Error(t("system.zip.archiveNeedsZip64"));
    }
    const record = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0x800, true);
    view.setUint32(14, crc32(contents), true);
    view.setUint32(18, contents.length, true);
    view.setUint32(22, contents.length, true);
    view.setUint16(26, nameBytes.length, true);
    record.set(nameBytes, 30);
    const directory = new Uint8Array(46 + nameBytes.length);
    const central = new DataView(directory.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    directory.set(record.subarray(4, 30), 6);
    central.setUint32(42, offset, true);
    directory.set(nameBytes, 46);
    records.push(record, toBlobPart(contents));
    directories.push(directory);
    offset += record.length + contents.length;
  }
  const trailer = new Uint8Array(22);
  const view = new DataView(trailer.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.size, true);
  view.setUint16(10, files.size, true);
  const directorySize = directories.reduce((total, entry) => total + entry.length, 0);
  if (directorySize >= ZIP64_MARKER) {
    throw new Error(t("system.zip.directoryNeedsZip64"));
  }
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return new Blob([...records, ...directories, trailer], { type: "application/zip" });
}
