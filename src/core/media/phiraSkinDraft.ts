/**
 * Authoring rules for Phira skin packages.
 *
 * The skin workbench edits one canonical asset slot at a time. This module
 * names those slots, maps them to Phira's fixed file layout, reads a loaded pack
 * back into the same slots, and assembles the package the guarded installer
 * validates. It owns no React, DOM, or file-dialog code.
 */
import { validatePngDimensions, type NoteSkinManifest } from "./noteSkin.ts";
import { parsePhiraRespack, serializePhiraRespack, type PhiraInfo } from "./phiraRespack.ts";

/** Every asset the workbench must fill before it can write a package. */
export const PHIRA_WORKBENCH_SLOTS = [
  "tap",
  "tap_highlight",
  "drag",
  "drag_highlight",
  "flick",
  "flick_highlight",
  "hold",
  "hold_highlight",
  "event_hold",
  "judgeline",
  "hit_fx",
  "tap_sound",
  "drag_sound",
  "flick_sound",
] as const;

/** One canonical asset slot in a Phira skin. */
export type PhiraWorkbenchSlot = (typeof PHIRA_WORKBENCH_SLOTS)[number];

/** The canonical Phira path each slot writes to. */
export const PHIRA_WORKBENCH_FILES: Record<PhiraWorkbenchSlot, string> = {
  tap: "click.png",
  tap_highlight: "click_mh.png",
  drag: "drag.png",
  drag_highlight: "drag_mh.png",
  flick: "flick.png",
  flick_highlight: "flick_mh.png",
  hold: "hold.png",
  hold_highlight: "hold_mh.png",
  event_hold: "event_hold.png",
  judgeline: "line.png",
  hit_fx: "hit_fx.png",
  tap_sound: "click.ogg",
  drag_sound: "drag.ogg",
  flick_sound: "flick.ogg",
};

/** One filled slot: the bytes plus geometry that cannot be inferred from them. */
export interface PhiraWorkbenchAsset {
  readonly bytes: Uint8Array;
  /** The source file name, kept only for display. */
  readonly fileName: string;
  /** The other skin this asset was copied from, when it was reused. */
  readonly source?: string;
  /** Source bitmap width in pixels; absent for audio. */
  readonly width?: number;
  /** Source bitmap height in pixels; absent for audio. */
  readonly height?: number;
  /** Hold atlas boundaries in source pixels, `[tailHeight, headHeight]`. */
  readonly atlas?: readonly [number, number];
  /** Hit-effect frames, `[columns, rows]`. */
  readonly grid?: readonly [number, number];
}

/** A workbench package keyed by canonical slot. */
export type PhiraWorkbenchDraft = Partial<Record<PhiraWorkbenchSlot, PhiraWorkbenchAsset>>;

/** The subset of a loaded skin the workbench reads. */
export interface PhiraWorkbenchPack {
  readonly manifest: NoteSkinManifest;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/** A loaded pack retaining its selection id for fallback composition. */
export interface PhiraWorkbenchLoadedPack extends PhiraWorkbenchPack {
  readonly id: string;
  readonly files: Map<string, Uint8Array>;
}

/** Whether a Hold asset still has a usable tail/body/head split. */
export function phiraHoldAtlasValid(asset: PhiraWorkbenchAsset | undefined): boolean {
  if (!asset?.atlas || !asset.height) {
    return false;
  }
  return (
    Number.isInteger(asset.atlas[0]) &&
    Number.isInteger(asset.atlas[1]) &&
    asset.atlas[0] > 0 &&
    asset.atlas[1] > 0 &&
    asset.atlas[0] + asset.atlas[1] < asset.height
  );
}

/** Whether a hit-effect atlas divides exactly by its configured grid. */
export function phiraHitGridValid(asset: PhiraWorkbenchAsset | undefined): boolean {
  if (!asset?.grid || !asset.width || !asset.height) {
    return false;
  }
  const [columns, rows] = asset.grid;
  return (
    columns > 0 &&
    rows > 0 &&
    columns * rows <= 10240 &&
    asset.width % columns === 0 &&
    asset.height % rows === 0
  );
}

/** The manifest file that supplies one slot, when the pack provides it. */
function slotFile(manifest: NoteSkinManifest, slot: PhiraWorkbenchSlot): string | undefined {
  const note = (name: string): string | undefined => manifest.notes[name]?.file;
  switch (slot) {
    case "tap":
      return note("tap");
    case "tap_highlight":
      return note("tap_highlight");
    case "drag":
      return note("drag");
    case "drag_highlight":
      return note("drag_highlight");
    case "flick":
      return note("flick");
    case "flick_highlight":
      return note("flick_highlight");
    case "hold":
      // A legacy normalized pack stores separate head/body/end images, not one
      // Phira atlas. Leave the slot empty until the author supplies or reuses an
      // atlas rather than exporting a head image as a whole Hold.
      return manifest.phira?.holdFile;
    case "hold_highlight":
      return manifest.phira?.holdFileMH;
    case "event_hold":
      return manifest.events.event_hold?.file ?? manifest.events.event_bar?.file;
    case "judgeline":
      return manifest.judgeline?.line.file;
    case "hit_fx":
      return manifest.phira?.hitFxFile;
    case "tap_sound":
      return manifest.audio?.tap;
    case "drag_sound":
      return manifest.audio?.drag;
    case "flick_sound":
      return manifest.audio?.flick;
  }
}

/** The last path segment of a package-relative file. */
function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

/** Read one slot from a loaded pack, or null when the pack does not provide it. */
export function phiraWorkbenchAssetFromPack(
  pack: PhiraWorkbenchPack,
  slot: PhiraWorkbenchSlot,
): PhiraWorkbenchAsset | null {
  const file = slotFile(pack.manifest, slot);
  if (!file) {
    return null;
  }
  const bytes = pack.files.get(file);
  if (!bytes) {
    return null;
  }
  const phira = pack.manifest.phira;
  const audio = slot === "tap_sound" || slot === "drag_sound" || slot === "flick_sound";
  const dimensions = audio ? null : validatePngDimensions(bytes);
  return {
    bytes,
    fileName: baseName(file),
    ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
    ...(slot === "hold" && phira ? { atlas: phira.info.holdAtlas } : {}),
    ...(slot === "hold_highlight" && phira ? { atlas: phira.info.holdAtlasMH } : {}),
    ...(slot === "hit_fx" && phira ? { grid: phira.info.hitFx } : {}),
  };
}

/** Read every provided slot from a pack. */
export function phiraWorkbenchDraftFromPack(pack: PhiraWorkbenchPack): PhiraWorkbenchDraft {
  const draft: PhiraWorkbenchDraft = {};
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    const asset = phiraWorkbenchAssetFromPack(pack, slot);
    if (asset) {
      draft[slot] = asset;
    }
  }
  return draft;
}

/**
 * Package files the workbench does not edit.
 *
 * Phira clients may read optional resources beyond the fixed skin set. A save
 * carries them through so editing a package never silently drops a file the
 * workbench has no slot for.
 */
export function phiraWorkbenchExtrasFromPack(pack: PhiraWorkbenchPack): Map<string, Uint8Array> {
  const consumed = new Set<string>(["info.yml"]);
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    const file = slotFile(pack.manifest, slot);
    if (file) {
      consumed.add(file);
    }
  }
  const extras = new Map<string, Uint8Array>();
  for (const [name, bytes] of pack.files) {
    if (!consumed.has(name)) {
      extras.set(name, bytes);
    }
  }
  return extras;
}

/** Slots still missing from a draft, in canonical order. */
export function missingPhiraWorkbenchSlots(draft: PhiraWorkbenchDraft): PhiraWorkbenchSlot[] {
  return PHIRA_WORKBENCH_SLOTS.filter((slot) => !draft[slot]);
}

/**
 * Assemble a Phira package from a workbench draft.
 *
 * `baseInfo` carries the scalar metadata of the edited package so unrelated
 * Phira fields survive a save. Geometry that the workbench owns replaces the
 * base values. A complete save is the strict import/export contract; the
 * workbench opts into `allowIncomplete` so unfilled or unusable geometry slots
 * are omitted and the runtime can compose fallbacks.
 */
export function buildPhiraWorkbenchFiles({
  name,
  draft,
  baseInfo,
  extras,
  allowIncomplete = false,
}: {
  name: string;
  draft: PhiraWorkbenchDraft;
  baseInfo?: Partial<PhiraInfo>;
  /** Files carried through from the edited package, keyed by relative path. */
  extras?: ReadonlyMap<string, Uint8Array>;
  /** Keep missing or unusable slots out instead of refusing the save. */
  allowIncomplete?: boolean;
}): Map<string, Uint8Array> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("A skin name is required");
  }
  const missing = missingPhiraWorkbenchSlots(draft);
  if (!allowIncomplete && missing.length) {
    throw new Error(`Missing skin assets: ${missing.join(", ")}`);
  }
  const usable = new Set<PhiraWorkbenchSlot>();
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    const asset = draft[slot];
    if (!asset) {
      continue;
    }
    if ((slot === "hold" || slot === "hold_highlight") && !phiraHoldAtlasValid(asset)) {
      if (!allowIncomplete) {
        throw new Error(
          slot === "hold"
            ? "The hold atlas needs its cut heights"
            : "The highlighted hold atlas needs its cut heights",
        );
      }
      continue;
    }
    if (slot === "hit_fx" && !phiraHitGridValid(asset)) {
      if (!allowIncomplete) {
        throw new Error("The hit-effect atlas needs its frame grid");
      }
      continue;
    }
    usable.add(slot);
  }
  const files = new Map<string, Uint8Array>(extras ?? []);
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    const target = PHIRA_WORKBENCH_FILES[slot];
    if (usable.has(slot)) {
      files.set(target, (draft[slot] as PhiraWorkbenchAsset).bytes);
    } else {
      // A draft slot that is missing must not silently reappear through an
      // unrelated extra file carried from the source package.
      files.delete(target);
    }
  }
  const hold = usable.has("hold") ? draft.hold : undefined;
  const holdHighlight = usable.has("hold_highlight") ? draft.hold_highlight : undefined;
  const hitFx = usable.has("hit_fx") ? draft.hit_fx : undefined;
  const info: PhiraInfo = {
    ...(baseInfo ?? {}),
    name: trimmed,
    hitFx: hitFx?.grid ? [hitFx.grid[0], hitFx.grid[1]] : (baseInfo?.hitFx ?? [1, 1]),
    holdAtlas: hold?.atlas ? [hold.atlas[0], hold.atlas[1]] : (baseInfo?.holdAtlas ?? [1, 1]),
    holdAtlasMH: holdHighlight?.atlas
      ? [holdHighlight.atlas[0], holdHighlight.atlas[1]]
      : (baseInfo?.holdAtlasMH ?? [1, 1]),
    eventHold: PHIRA_WORKBENCH_FILES.event_hold,
  };
  const built = serializePhiraRespack(info, files);
  // The serializer only bounds file sizes; the parser is the single authority on
  // fixed-file completeness, Hold boundaries, and hit-effect grid alignment.
  parsePhiraRespack(built, { allowIncomplete });
  return built;
}

/**
 * Compose missing workbench slots from fallback packs.
 *
 * Sources are already ordered by preference: the built-in package first, then
 * the installed skins in picker order. A slot with no source stays missing so
 * the caller can surface it rather than inventing artwork.
 */
export function mergePhiraWorkbenchFallback(
  active: PhiraWorkbenchLoadedPack,
  sources: readonly PhiraWorkbenchPack[],
): PhiraWorkbenchLoadedPack {
  const draft = phiraWorkbenchDraftFromPack(active);
  for (const slot of PHIRA_WORKBENCH_SLOTS) {
    if (draft[slot]) {
      continue;
    }
    for (const source of sources) {
      const asset = phiraWorkbenchAssetFromPack(source, slot);
      if (asset) {
        draft[slot] = asset;
        break;
      }
    }
  }
  const info = active.manifest.phira?.info;
  const name =
    info?.name ?? (typeof active.manifest.name === "string" ? active.manifest.name : "Skin");
  const files = buildPhiraWorkbenchFiles({
    name,
    draft,
    baseInfo: info,
    extras: phiraWorkbenchExtrasFromPack(active),
    allowIncomplete: true,
  });
  return {
    id: active.id,
    manifest: parsePhiraRespack(files, { allowIncomplete: true }).manifest,
    files,
  };
}
