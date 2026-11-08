/**
 * Projects the active note skin into a canonical Phira respack file map.
 *
 * A skin is a Phira respack, so export copies the source package and adds only
 * the Redux extensions: an `event_hold.png` event-bar texture and the
 * package-root `line.png` judge-line texture. Packages that are not respacks are
 * rejected; no other skin format exists to convert.
 */
import { mediaType } from "../../../../core/media/mime.ts";
import { serializePhiraInfo } from "../../../../core/media/phiraRespack.ts";
import type { LoadedNoteSkin } from "../../../../core/media/noteSkins.ts";
import { toBlobPart } from "../../../../core/utils/bytes.ts";

/** Canonical package path of the Redux event-bar texture. */
const EVENT_HOLD_FILE = "event_hold.png";
/** Canonical package path of the Redux judge-line texture. */
const JUDGE_LINE_FILE = "line.png";
/** Previous package path of the judge-line texture, normalized on export. */
const LEGACY_JUDGE_LINE_FILE = "judgeline/line.png";

/** Decode one package bitmap for building or cropping a Redux texture. */
async function decodeExportImage(pack: LoadedNoteSkin, file: string): Promise<HTMLImageElement> {
  const bytes = pack.files.get(file);
  if (!bytes) {
    throw new Error(`Missing texture ${file}`);
  }
  const url = URL.createObjectURL(new Blob([toBlobPart(bytes)], { type: mediaType(file) }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Encode one canvas as a PNG byte array. */
async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Could not encode the event-bar texture");
  }
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Provide the Redux event-bar texture.
 *
 * Phira has no event texture of its own, so a package without `event_hold.png`
 * or an `eventHold` entry falls back to its Hold body strip, which the runtime
 * also uses for event bars. The strip lies between the tail and head slices of
 * the vertical Hold atlas.
 */
async function composeEventHold(pack: LoadedNoteSkin): Promise<Uint8Array> {
  const event = pack.manifest.events.event_hold;
  if (event) {
    const bytes = pack.files.get(event.file);
    if (bytes) {
      return bytes;
    }
  }
  const phira = pack.manifest.phira;
  if (!phira) {
    throw new Error("Only Phira resource packs can be exported");
  }
  const body = await decodeExportImage(pack, phira.holdFile);
  const [tail, head] = phira.info.holdAtlas;
  const height = body.naturalHeight - tail - head;
  if (height <= 0) {
    throw new Error("The Hold atlas has no body strip for the event bar");
  }
  const canvas = document.createElement("canvas");
  canvas.width = body.naturalWidth;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create the event-bar texture");
  }
  context.drawImage(body, 0, tail, body.naturalWidth, height, 0, 0, canvas.width, canvas.height);
  return canvasPng(canvas);
}

/** The judge-line bytes a package carries, at the canonical or the previous path. */
function judgeLineBytes(pack: LoadedNoteSkin): Uint8Array | undefined {
  const file = pack.manifest.judgeline?.line.file;
  const bytes = file ? pack.files.get(file) : undefined;
  return bytes ?? pack.files.get(LEGACY_JUDGE_LINE_FILE);
}

/**
 * Project a loaded Phira package into the canonical file map for export.
 *
 * The source package is copied, then the Redux extensions are written at their
 * canonical package-root paths: `event_hold.png` with its `eventHold` info.yml
 * entry, and the judge-line texture as `line.png`. `info.yml` is re-serialized
 * so the exported package states the current extension contract.
 */
export async function phiraExportFiles(pack: LoadedNoteSkin): Promise<Map<string, Uint8Array>> {
  const phira = pack.manifest.phira;
  if (!phira || !pack.files.has("info.yml")) {
    throw new Error("Only Phira resource packs can be exported");
  }
  const files = new Map(pack.files);
  // The Redux event bar always ships; an existing canonical file wins so a
  // hand-authored extension is never replaced by the fallback crop.
  if (!files.has(EVENT_HOLD_FILE)) {
    files.set(EVENT_HOLD_FILE, await composeEventHold(pack));
  }
  const lineBytes = judgeLineBytes(pack);
  if (lineBytes) {
    files.set(JUDGE_LINE_FILE, lineBytes);
  }
  files.delete(LEGACY_JUDGE_LINE_FILE);
  files.set(
    "info.yml",
    new TextEncoder().encode(serializePhiraInfo({ ...phira.info, eventHold: EVENT_HOLD_FILE })),
  );
  return files;
}
