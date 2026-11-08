/**
 * Phira zip intake shared by the settings import button and the workbench drop
 * target. The archive is expanded here; package validation stays in
 * `core/media/phiraRespack.ts`.
 */
import { unzipSync } from "fflate";

/** Whether a dropped file should be treated as a zip package. */
export function looksLikePhiraZip(file: File): boolean {
  return (
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    /\.zip$/i.test(file.name)
  );
}

/** Whether a drop is a zip file or a directory that may contain a package. */
export function isPhiraPackageTransfer(transfer: DataTransfer): boolean {
  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      return true;
    }
  }
  return Array.from(transfer.files).some(looksLikePhiraZip);
}

/** Read one `readEntries` batch, repeating until the directory is exhausted. */
function readDirectoryBatch(directory: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const reader = directory.createReader();
    const entries: FileSystemEntry[] = [];
    const read = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        read();
      }, reject);
    };
    read();
  });
}

/** Read one file entry as bytes. */
function readFileEntry(entry: FileSystemFileEntry): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    entry.file((file) => {
      void file.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, reject);
  });
}

/** Read a dropped directory as a relative package file map. */
async function readDirectory(root: FileSystemDirectoryEntry): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const walk = async (directory: FileSystemDirectoryEntry, prefix: string): Promise<void> => {
    for (const entry of await readDirectoryBatch(directory)) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await walk(entry as FileSystemDirectoryEntry, relative);
      } else if (entry.isFile) {
        files.set(relative, await readFileEntry(entry as FileSystemFileEntry));
      }
    }
  };
  await walk(root, "");
  const infoPath = [...files.keys()].find((name) => name.split("/").at(-1) === "info.yml");
  if (!infoPath) {
    throw new Error("The folder does not contain info.yml");
  }
  const prefix = infoPath.slice(0, -"info.yml".length);
  if (!prefix) {
    return files;
  }
  const packageFiles = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    if (name.startsWith(prefix)) {
      packageFiles.set(name.slice(prefix.length), bytes);
    }
  }
  return packageFiles;
}

/** Read a dropped zip or directory into a package file map. */
export async function readDroppedPhiraPackage(
  transfer: DataTransfer,
): Promise<Map<string, Uint8Array>> {
  for (const item of Array.from(transfer.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) {
      return readDirectory(entry as FileSystemDirectoryEntry);
    }
  }
  const file = Array.from(transfer.files).find(looksLikePhiraZip) ?? transfer.files[0];
  if (!file) {
    throw new Error("The drop does not contain a Phira skin package");
  }
  return unpackPhira(new Uint8Array(await file.arrayBuffer()));
}

/** Expand a zip and strip one optional top-level folder from its paths. */
export function unpackPhira(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = unzipSync(bytes);
  const infoPath = Object.keys(entries).find((name) => name.split("/").at(-1) === "info.yml");
  if (!infoPath) {
    throw new Error("The archive does not contain info.yml");
  }
  const prefix = infoPath.slice(0, -"info.yml".length);
  const files = new Map<string, Uint8Array>();
  for (const [name, value] of Object.entries(entries)) {
    if (name.endsWith("/")) {
      continue;
    }
    if (!name.startsWith(prefix)) {
      continue;
    }
    files.set(name.slice(prefix.length), value);
  }
  return files;
}
