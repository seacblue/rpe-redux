/**
 * The note-skin page of the settings window.
 *
 * The page owns package selection and import/export. Authored assets live in
 * `SkinWorkbench`: this surface only decides which package the workbench opens.
 * Import and export report their result through the shared toast stack, so a
 * cancelled file or save dialog raises nothing.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Select } from "../../../../design/components/select/Select.tsx";
import { InlineAlert } from "../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { Button } from "../../../../design/components/button/Button.tsx";
import { showToast } from "../../../../design/patterns/ToastHost.tsx";
import {
  DEFAULT_NOTE_SKIN,
  EXTERNAL_NOTE_SKIN_PREFIX,
  loadNoteSkin,
  loadNoteSkinWithFallback,
  selectNoteSkin,
  unresolvedNoteSkinSlots,
} from "../../../../core/media/noteSkins.ts";
import {
  missingPhiraWorkbenchSlots,
  phiraWorkbenchDraftFromPack,
  type PhiraWorkbenchSlot,
} from "../../../../core/media/phiraSkinDraft.ts";
import {
  externalNoteSkins,
  installPhiraNoteSkin,
  refreshExternalNoteSkins,
  subscribeExternalNoteSkins,
} from "../../../../core/platform/desktop/noteSkinPackages.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { registerSettingsPage } from "../settingsContributions.ts";
import { useActiveNoteSkin } from "./useActiveNoteSkin.ts";
import { bundledNoteSkinName, NOTE_SKIN_EVENT } from "../../../platform/noteSkinBridge.ts";
import { packageName, packageSlug, type PackageName } from "../../../../core/utils/packageName.ts";
import { pickFiles } from "../../../platform/filePicker.ts";
import { isDesktop } from "../../../../core/platform/environment.ts";
import {
  dialogDefaultPath,
  rememberDialogFile,
} from "../../../../core/platform/desktop/dialogPath.ts";
import { writeExportBytes } from "../../../platform/desktop/externalChart.ts";
import { zipSync } from "fflate";
import { phiraExportFiles } from "./phiraExport.ts";
import { unpackPhira } from "./phiraPackage.ts";
import { SkinWorkbench, type SkinWorkbenchMode } from "./SkinWorkbench.tsx";
import { WORKBENCH_SLOTS } from "./skinWorkbenchSlots.ts";
import { MODAL_PRIORITY } from "../../../overlays/modals/modalQueue.ts";
import { requestConfirm, showNotice } from "../../../overlays/modals/prompts.ts";

/** The package picker and the entry points into the skin workbench. */
export function SkinSettings() {
  const { t, language } = useTranslation();
  const active = useActiveNoteSkin();
  const [bundledName, setBundledName] = useState<PackageName>("Redux Default");
  /** Re-read the bundled name; saving or deleting an override renames it. */
  const refreshBundledName = useCallback(() => {
    void bundledNoteSkinName()
      .then((name) => setBundledName(name))
      .catch(() => undefined);
  }, []);
  // The bundled entry's label follows the active override, so re-read it on
  // every skin change instead of caching one read from mount.
  useEffect(() => {
    refreshBundledName();
    window.addEventListener(NOTE_SKIN_EVENT, refreshBundledName);
    return () => window.removeEventListener(NOTE_SKIN_EVENT, refreshBundledName);
  }, [refreshBundledName]);
  const external = useSyncExternalStore(
    subscribeExternalNoteSkins,
    externalNoteSkins,
    externalNoteSkins,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [workbench, setWorkbench] = useState<SkinWorkbenchMode | null>(null);
  const [scanned, setScanned] = useState(false);
  // Rescan external packages on mount and mark the scan as finished.
  useEffect(() => {
    let mounted = true;
    void refreshExternalNoteSkins().finally(() => {
      if (mounted) {
        setScanned(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  const activeExternal = external.find(
    (skin) => `${EXTERNAL_NOTE_SKIN_PREFIX}${skin.id}` === active,
  );
  const missingId =
    scanned && active.startsWith(EXTERNAL_NOTE_SKIN_PREFIX) && !activeExternal
      ? active.slice(EXTERNAL_NOTE_SKIN_PREFIX.length)
      : "";
  const unresolvedKey = `${active}\u0000${missingId}\u0000${external
    .map((skin) => `${skin.id}:${skin.fingerprint}`)
    .join("\u0000")}`;
  const [unresolvedState, setUnresolvedState] = useState<{
    key: string;
    slots: PhiraWorkbenchSlot[];
  } | null>(null);
  const unresolvedSlots = unresolvedState?.key === unresolvedKey ? unresolvedState.slots : [];
  /** The workbench label for one canonical slot. */
  const slotLabel = (slot: PhiraWorkbenchSlot): string => {
    const definition = WORKBENCH_SLOTS.find((candidate) => candidate.slot === slot);
    return definition ? t(definition.label) : slot;
  };
  useEffect(() => {
    if (!active || missingId) {
      return undefined;
    }
    let cancelled = false;
    void unresolvedNoteSkinSlots(active)
      .then((slots) => {
        if (!cancelled) {
          setUnresolvedState({ key: unresolvedKey, slots });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnresolvedState({ key: unresolvedKey, slots: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, missingId, unresolvedKey]);

  /** Import one Phira zip, install it, and announce the result. */
  const importPhira = async () => {
    const picked = await pickFiles({ accept: ".zip", multiple: false });
    const file = picked?.[0];
    if (!file) {
      return;
    }
    setActionBusy(true);
    try {
      const files = unpackPhira(new Uint8Array(await file.arrayBuffer()));
      const installed = await installPhiraNoteSkin(files, undefined, { allowIncomplete: true });
      await selectNoteSkin(`${EXTERNAL_NOTE_SKIN_PREFIX}${installed.id}`);
      await refreshExternalNoteSkins();
      showToast({
        message: t("settings.skin.notice.imported", {
          name: packageName(installed.name, language),
        }),
        level: "success",
      });
    } catch (cause) {
      showToast({
        message: t("settings.skin.error.action", { message: String(cause) }),
        level: "error",
      });
    } finally {
      setActionBusy(false);
    }
  };

  /** Export the selected package, warning when fallbacks are needed. */
  const exportPhira = async () => {
    setActionBusy(true);
    try {
      const raw = await loadNoteSkin(active);
      const missing = missingPhiraWorkbenchSlots(phiraWorkbenchDraftFromPack(raw));
      let pack = raw;
      if (missing.length) {
        const parts = missing.map(slotLabel).join(", ");
        const confirmed = await requestConfirm({
          title: t("settings.skin.export.incomplete.title"),
          description: t("settings.skin.export.incomplete.description", { parts }),
          label: t("settings.skin.export.incomplete.confirm"),
          cancelLabel: t("settings.skin.export.incomplete.cancel"),
          priority: MODAL_PRIORITY.closePrompt,
        });
        if (!confirmed) {
          return;
        }
        pack = await loadNoteSkinWithFallback(active);
        const unresolved = missingPhiraWorkbenchSlots(phiraWorkbenchDraftFromPack(pack));
        if (unresolved.length) {
          showNotice({
            title: t("settings.skin.export.unresolved.title"),
            description: t("settings.skin.export.unresolved.description", {
              parts: unresolved.map(slotLabel).join(", "),
            }),
            priority: MODAL_PRIORITY.closePrompt,
          });
          return;
        }
      }
      const files = await phiraExportFiles(pack);
      const archive = zipSync(Object.fromEntries(files), { level: 6 });
      const fileName = `${packageSlug(pack.manifest.name)}.zip`;
      if (isDesktop()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const path = await save({
          defaultPath: dialogDefaultPath("skin", fileName),
          filters: [{ name: t("settings.skin.export.filter"), extensions: ["zip"] }],
        });
        if (!path) {
          return;
        }
        rememberDialogFile("skin", path);
        await writeExportBytes(path, archive);
        showToast({
          message: t("settings.skin.notice.exported", {
            name: path.split(/[\\/]/).at(-1) ?? path,
          }),
          level: "success",
        });
      } else {
        const url = URL.createObjectURL(new Blob([archive], { type: "application/zip" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fileName;
        anchor.click();
        URL.revokeObjectURL(url);
        showToast({
          message: t("settings.skin.notice.exported", { name: fileName }),
          level: "success",
        });
      }
    } catch (cause) {
      showToast({
        message: t("settings.skin.error.action", { message: String(cause) }),
        level: "error",
      });
    } finally {
      setActionBusy(false);
    }
  };

  /** Open the workbench for the active package or an empty board. */
  const openWorkbench = (mode: SkinWorkbenchMode) => {
    setWorkbench(mode);
  };

  /** The select option is an action rather than a selectable skin. */
  const handleSkinChange = (value: string) => {
    if (value === "__new-phira-skin__") {
      openWorkbench("create");
      return;
    }
    void selectNoteSkin(value);
  };
  return (
    <div className="redux-skin">
      <section className="redux-skin-current">
        <FieldRow
          className="redux-setting"
          data-setting="note-skin"
          htmlFor="note-skin-select"
          label={
            <span className="redux-setting-label-with-status">
              {t("settings.skin.field.label")}
              {unresolvedSlots.length > 0 && (
                <span
                  className="redux-setting-restart-marker"
                  role="img"
                  aria-label={t("settings.skin.warning.incompleteActive", {
                    parts: unresolvedSlots.map(slotLabel).join(", "),
                  })}
                  data-tip-title={t("settings.skin.warning.incompleteTitle")}
                  data-tip-desc={unresolvedSlots.map(slotLabel).join(", ")}
                />
              )}
            </span>
          }
          control={
            <Select
              id="note-skin-select"
              value={active}
              onChange={(event) => handleSkinChange(event.target.value)}
            >
              <option value={DEFAULT_NOTE_SKIN}>{packageName(bundledName, language)}</option>
              {external.map((skin) => (
                <option key={skin.id} value={`${EXTERNAL_NOTE_SKIN_PREFIX}${skin.id}`}>
                  {packageName(skin.name, language)}
                </option>
              ))}
              {missingId && (
                <option value={active}>
                  {t("settings.skin.option.missing", { id: missingId })}
                </option>
              )}
              <option value="__new-phira-skin__" data-select-tone="muted">
                {t("settings.skin.action.newPhira")}
              </option>
            </Select>
          }
        />
        <div className="redux-skin-actions">
          <Button
            variant="outlined"
            disabled={actionBusy || Boolean(missingId)}
            onClick={() => openWorkbench("edit")}
          >
            {t("settings.skin.action.edit")}
          </Button>
          <Button variant="outlined" disabled={actionBusy} onClick={() => void importPhira()}>
            {t("settings.skin.action.importPhira")}
          </Button>
          <Button
            variant="outlined"
            disabled={actionBusy || Boolean(missingId)}
            onClick={() => void exportPhira()}
          >
            {t("settings.skin.action.exportPhira")}
          </Button>
        </div>
      </section>

      {workbench && (
        <SkinWorkbench
          key={workbench}
          mode={workbench}
          skinId={workbench === "edit" ? active : undefined}
          open
          onClose={() => setWorkbench(null)}
          onSaved={refreshBundledName}
        />
      )}

      {missingId && (
        <InlineAlert tone="warning" className="redux-skin-warning">
          {t("settings.skin.warning.missingActive", { id: missingId })}
        </InlineAlert>
      )}
    </div>
  );
}

registerSettingsPage("appearance.skin", {
  keywords: "settings.search.skinKeywords",
  component: SkinSettings,
});
