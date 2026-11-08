/**
 * Loads the installed skins that provide one workbench slot.
 *
 * The reuse chooser is a context-menu submenu, not a page of its own, so this
 * hook owns only the candidate list and its request status. Copying the chosen
 * bytes into the draft stays with the workbench.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_NOTE_SKIN,
  EXTERNAL_NOTE_SKIN_PREFIX,
  loadNoteSkin,
} from "../../../../core/media/noteSkins.ts";
import {
  phiraWorkbenchAssetFromPack,
  type PhiraWorkbenchAsset,
  type PhiraWorkbenchSlot,
} from "../../../../core/media/phiraSkinDraft.ts";
import {
  externalNoteSkins,
  subscribeExternalNoteSkins,
} from "../../../../core/platform/desktop/noteSkinPackages.ts";
import { packageName, type PackageName } from "../../../../core/utils/packageName.ts";
import { useLanguage } from "../../../../i18n/react.ts";
import { bundledNoteSkinName } from "../../../platform/noteSkinBridge.ts";

/** One installed skin that can fill the requested slot. */
export interface ReusableSkinEntry {
  readonly id: string;
  readonly label: string;
  readonly asset: PhiraWorkbenchAsset;
}

interface ReuseResult {
  readonly key: string;
  readonly entries: ReusableSkinEntry[];
  readonly failed: boolean;
}

/** Load one source package and keep it only when it provides the slot. */
async function loadEntry(
  id: string,
  label: string,
  slot: PhiraWorkbenchSlot,
): Promise<ReusableSkinEntry | null> {
  try {
    const pack = await loadNoteSkin(id);
    const asset = phiraWorkbenchAssetFromPack(pack, slot);
    return asset ? { id, label, asset } : null;
  } catch {
    return null;
  }
}

/** Lists the other skins that can fill one slot. */
export function useReusableSkins(
  slot: PhiraWorkbenchSlot | null,
  excludeId?: string,
): {
  entries: readonly ReusableSkinEntry[];
  loading: boolean;
  failed: boolean;
} {
  const language = useLanguage();
  const external = useSyncExternalStore(
    subscribeExternalNoteSkins,
    externalNoteSkins,
    externalNoteSkins,
  );
  const requestKey = slot
    ? `${slot}\u0000${excludeId ?? ""}\u0000${language}\u0000${external
        .map((skin) => `${skin.id}:${skin.fingerprint}`)
        .join("\u0000")}`
    : "";
  const [result, setResult] = useState<ReuseResult | null>(null);
  const current = slot !== null && result?.key === requestKey ? result : null;

  useEffect(() => {
    if (!slot) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      const bundledName: PackageName = await bundledNoteSkinName().catch(() => "Redux Default");
      const sources = [
        { id: DEFAULT_NOTE_SKIN, label: packageName(bundledName, language) },
        ...external.map((skin) => ({
          id: `${EXTERNAL_NOTE_SKIN_PREFIX}${skin.id}`,
          label: packageName(skin.name, language),
        })),
      ].filter((source) => source.id !== excludeId);
      const loaded = await Promise.all(
        sources.map((source) => loadEntry(source.id, source.label, slot)),
      );
      if (!cancelled) {
        setResult({
          key: requestKey,
          entries: loaded.filter((entry): entry is ReusableSkinEntry => entry !== null),
          failed: false,
        });
      }
    })().catch(() => {
      if (!cancelled) {
        setResult({ key: requestKey, entries: [], failed: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [excludeId, external, language, requestKey, slot]);

  return {
    entries: current?.entries ?? [],
    loading: slot !== null && current === null,
    failed: current?.failed ?? false,
  };
}
