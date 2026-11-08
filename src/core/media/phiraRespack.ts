/**
 * Phira respack parsing and serialization.
 *
 * Phira is the product skin format: an info.yml file names fixed note, effect,
 * and sound resources. Redux's own extensions are optional files in the same
 * package and are ignored by Phira clients that do not know them: the event-bar
 * texture `event_hold.png` and the judge-line texture at the package root
 * `line.png`.
 */
import { isPackageName, type PackageName } from "../utils/packageName.ts";
import { isRecord } from "../utils/guards.ts";
import type { NoteSkinManifest, NoteTexture, UsefulRect } from "./noteSkin.ts";

const SKIN_MAX_BYTES = 64 * 1024 * 1024;
const SKIN_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const SKIN_MAX_FILES = 256;

/** Parse options for packages the workbench may save while incomplete. */
export interface PhiraParseOptions {
  /** Accept a package that omits fixed images or atlas geometry. */
  allowIncomplete?: boolean;
}

/** The fixed bitmap names required by the Phira respack format. */
export const PHIRA_REQUIRED_IMAGES = [
  "click.png",
  "click_mh.png",
  "drag.png",
  "drag_mh.png",
  "flick.png",
  "flick_mh.png",
  "hold.png",
  "hold_mh.png",
  "hit_fx.png",
] as const;

/** The scalar metadata accepted from Phira's info.yml. */
export interface PhiraInfo {
  name: string;
  author?: string;
  description?: string;
  hitFx: [number, number];
  holdAtlas: [number, number];
  holdAtlasMH: [number, number];
  hitFxDuration?: number;
  hitFxScale?: number;
  hitFxRotate?: boolean;
  hitFxTinted?: boolean;
  hideParticles?: boolean;
  holdKeepHead?: boolean;
  holdRepeat?: boolean;
  holdCompact?: boolean;
  colorPerfect?: number;
  colorGood?: number;
  /** Redux extension: an event hold texture in the same package. */
  eventHold?: string;
}

/** A complete Phira package as bytes plus the normalized Redux view. */
export interface ParsedPhiraRespack {
  info: PhiraInfo;
  files: Map<string, Uint8Array>;
  manifest: NoteSkinManifest;
}

const DEFAULT_INFO: Omit<PhiraInfo, "name"> = {
  hitFx: [5, 6],
  holdAtlas: [50, 50],
  holdAtlasMH: [50, 50],
};

/** Strip an inline YAML comment without touching a quoted # character. */
function stripComment(value: string): string {
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? "" : character;
    }
    if (character === "#" && !quote && (index === 0 || /\s/.test(value[index - 1] ?? ""))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trim();
}

/** Parse the scalar subset used by Phira's flat info.yml schema. */
function parseScalar(raw: string): unknown {
  const value = stripComment(raw).trim();
  if (!value) {
    return undefined;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("''", "'");
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => parseScalar(entry.trim()))
      .filter((entry) => entry !== undefined);
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  if (/^0x[0-9a-f]+$/i.test(value)) {
    return Number.parseInt(value.slice(2), 16);
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    return Number(value);
  }
  return value;
}

/** Parse the flat key/value YAML used by Phira resource packs. */
function parseInfoYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new Error("Invalid Phira info.yml entry");
    }
    const key = line.slice(0, separator).trim();
    const value = parseScalar(line.slice(separator + 1));
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Require a finite number pair such as holdAtlas or hitFx. */
function pair(value: unknown, fallback: [number, number], key: string): [number, number] {
  if (value === undefined) {
    return [...fallback] as [number, number];
  }
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((entry) => typeof entry === "number" && Number.isInteger(entry) && entry > 0)
  ) {
    throw new Error(`Invalid Phira ${key}; expected two positive integers`);
  }
  return [value[0] as number, value[1] as number];
}

/** Normalize parsed YAML into the runtime Phira metadata contract. */
function normalizeInfo(raw: Record<string, unknown>): PhiraInfo {
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    throw new Error("Phira info.yml is missing name");
  }
  const info: PhiraInfo = {
    name: raw.name,
    hitFx: pair(raw.hitFx, DEFAULT_INFO.hitFx, "hitFx"),
    holdAtlas: pair(raw.holdAtlas, DEFAULT_INFO.holdAtlas, "holdAtlas"),
    holdAtlasMH: pair(raw.holdAtlasMH, DEFAULT_INFO.holdAtlasMH, "holdAtlasMH"),
  };
  for (const key of ["author", "description"] as const) {
    if (typeof raw[key] === "string") {
      info[key] = raw[key];
    }
  }
  for (const key of ["hitFxDuration", "hitFxScale", "colorPerfect", "colorGood"] as const) {
    if (typeof raw[key] === "number" && Number.isFinite(raw[key])) {
      info[key] = raw[key];
    }
  }
  for (const key of [
    "hitFxRotate",
    "hitFxTinted",
    "hideParticles",
    "holdKeepHead",
    "holdRepeat",
    "holdCompact",
  ] as const) {
    if (typeof raw[key] === "boolean") {
      info[key] = raw[key];
    }
  }
  if (typeof raw.eventHold === "string" && raw.eventHold.trim()) {
    info.eventHold = raw.eventHold;
  }
  return info;
}

/** Validate the PNG signature and dimensions before the browser decodes it. */
function validatePngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) {
    throw new Error("Phira image is not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height || width > 4096 || height > 4096 || width * height > 16 * 1024 * 1024) {
    throw new Error("Phira image dimensions exceed the limit");
  }
  return { width, height };
}

/** The full image rectangle used by Phira, which has no useful rectangle. */
function fullRect(bytes: Uint8Array): UsefulRect {
  const { width, height } = validatePngDimensions(bytes);
  return { x: 0, y: 0, width, height };
}

/** A safe relative package path. */
function packagePath(value: string): string {
  if (
    !value ||
    value.startsWith("/") ||
    /[\\:\0]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid Phira package path: ${value}`);
  }
  return value;
}

/** Validate a package's file map before it reaches the decoder or exporter. */
function validateFiles(files: ReadonlyMap<string, Uint8Array>): void {
  let total = 0;
  if (files.size > SKIN_MAX_FILES) {
    throw new Error("Phira resource pack has too many files");
  }
  for (const [name, bytes] of files) {
    packagePath(name);
    total += bytes.byteLength;
    if (total > SKIN_MAX_BYTES) {
      throw new Error("Phira resource pack is too large");
    }
    if (name.toLowerCase().endsWith(".png")) {
      if (bytes.byteLength > SKIN_IMAGE_MAX_BYTES) {
        throw new Error(`Phira image is too large: ${name}`);
      }
      validatePngDimensions(bytes);
    }
  }
}

/** Validate atlas boundaries and hit-effect grid alignment against present PNGs. */
function validateAtlasGeometry(
  info: PhiraInfo,
  files: ReadonlyMap<string, Uint8Array>,
  allowIncomplete: boolean,
): void {
  for (const [key, file, atlas] of [
    ["holdAtlas", "hold.png", info.holdAtlas],
    ["holdAtlasMH", "hold_mh.png", info.holdAtlasMH],
  ] as const) {
    const bytes = files.get(file);
    if (!bytes) {
      if (allowIncomplete) {
        continue;
      }
      throw new Error(`Missing Phira image: ${file}`);
    }
    const { height } = validatePngDimensions(bytes);
    if (atlas[0] + atlas[1] >= height) {
      throw new Error(`Phira ${key} exceeds ${file} height`);
    }
  }
  const hitFx = files.get("hit_fx.png");
  if (!hitFx) {
    if (allowIncomplete) {
      return;
    }
    throw new Error("Missing Phira image: hit_fx.png");
  }
  const { width, height } = validatePngDimensions(hitFx);
  if (width % info.hitFx[0] !== 0 || height % info.hitFx[1] !== 0) {
    throw new Error("Phira hit_fx.png dimensions do not match hitFx grid");
  }
}

/** Construct normalized note slots from the files a Phira package provides. */
function normalizedManifest(
  info: PhiraInfo,
  files: ReadonlyMap<string, Uint8Array>,
  allowIncomplete: boolean,
): NoteSkinManifest {
  const image = (file: string): NoteTexture | undefined => {
    const bytes = files.get(file);
    if (!bytes) {
      if (allowIncomplete) {
        return undefined;
      }
      throw new Error(`Missing Phira image: ${file}`);
    }
    return { file, useful: fullRect(bytes) };
  };
  const notes: Record<string, NoteTexture> = {};
  const add = (name: string, file: string) => {
    const texture = image(file);
    if (texture) {
      notes[name] = texture;
    }
  };
  add("tap", "click.png");
  add("tap_highlight", "click_mh.png");
  add("drag", "drag.png");
  add("drag_highlight", "drag_mh.png");
  add("flick", "flick.png");
  add("flick_highlight", "flick_mh.png");
  for (const name of ["hold_head", "hold_body", "hold_end"] as const) {
    add(name, "hold.png");
  }
  for (const name of ["hold_head_highlight", "hold_body_highlight"] as const) {
    add(name, "hold_mh.png");
  }
  const eventPath =
    info.eventHold && files.has(info.eventHold)
      ? info.eventHold
      : files.has("event_hold.png")
        ? "event_hold.png"
        : undefined;
  const eventTexture = eventPath ? image(eventPath) : undefined;
  const eventFile = eventTexture?.file;
  const lineTexture = files.has("line.png") ? image("line.png") : undefined;
  const name: PackageName = isPackageName(info.name) ? info.name : "Phira skin";
  return {
    name,
    notes,
    events: eventTexture ? { event_hold: eventTexture } : {},
    ...(lineTexture ? { judgeline: { line: lineTexture } } : {}),
    phira: {
      info,
      holdFile: "hold.png",
      holdFileMH: "hold_mh.png",
      hitFxFile: "hit_fx.png",
      eventHoldFile: eventFile,
    },
    audio: Object.fromEntries(
      (["tap", "drag", "flick"] as const)
        .map((name) => [name, `${name === "tap" ? "click" : name}.ogg`])
        .filter(([, file]) => files.has(file)),
    ),
  };
}

/**
 * Parse a Phira respack and return the normalized runtime package.
 *
 * Strict parsing is the import/drop contract. The workbench saves partial packs,
 * and the runtime loader composes them with fallbacks, so it opts into
 * `allowIncomplete` instead.
 */
export function parsePhiraRespack(
  files: ReadonlyMap<string, Uint8Array>,
  options: PhiraParseOptions = {},
): ParsedPhiraRespack {
  const allowIncomplete = options.allowIncomplete === true;
  validateFiles(files);
  const infoBytes = files.get("info.yml");
  if (!infoBytes) {
    throw new Error("Phira resource pack is missing info.yml");
  }
  const info = normalizeInfo(parseInfoYaml(new TextDecoder().decode(infoBytes)));
  if (!allowIncomplete) {
    for (const file of PHIRA_REQUIRED_IMAGES) {
      if (!files.has(file)) {
        throw new Error(`Phira resource pack is missing ${file}`);
      }
    }
  }
  if (info.hitFx[0] <= 0 || info.hitFx[1] <= 0 || info.hitFx[0] * info.hitFx[1] > 10240) {
    throw new Error("Invalid Phira hitFx frame grid");
  }
  validateAtlasGeometry(info, files, allowIncomplete);
  return {
    info,
    files: new Map(files),
    manifest: normalizedManifest(info, files, allowIncomplete),
  };
}

/** Quote a YAML string while keeping generated packages deterministic. */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Serialize the supported Phira metadata fields. */
export function serializePhiraInfo(info: PhiraInfo): string {
  const lines = [`name: ${yamlString(info.name)}`];
  for (const key of ["author", "description"] as const) {
    if (info[key] !== undefined) {
      lines.push(`${key}: ${yamlString(info[key])}`);
    }
  }
  lines.push(`hitFx: [${info.hitFx.join(", ")}]`);
  lines.push(`holdAtlas: [${info.holdAtlas.join(", ")}]`);
  lines.push(`holdAtlasMH: [${info.holdAtlasMH.join(", ")}]`);
  for (const key of [
    "hitFxDuration",
    "hitFxScale",
    "hitFxRotate",
    "hitFxTinted",
    "hideParticles",
    "holdKeepHead",
    "holdRepeat",
    "holdCompact",
    "colorPerfect",
    "colorGood",
    "eventHold",
  ] as const) {
    const value = info[key];
    if (value === undefined) {
      continue;
    }
    lines.push(`${key}: ${typeof value === "string" ? yamlString(value) : String(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Build a Phira package file map, including the canonical info.yml. */
export function serializePhiraRespack(
  info: PhiraInfo,
  files: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const next = new Map(files);
  next.set("info.yml", new TextEncoder().encode(serializePhiraInfo(info)));
  validateFiles(next);
  return next;
}

/** Return the custom event_hold path when it is present and valid. */
export function eventHoldFile(manifest: NoteSkinManifest): string | undefined {
  if (!isRecord(manifest.phira)) {
    return undefined;
  }
  return typeof manifest.phira.eventHoldFile === "string"
    ? manifest.phira.eventHoldFile
    : undefined;
}
