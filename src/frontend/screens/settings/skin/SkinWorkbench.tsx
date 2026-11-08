/**
 * The skin workbench: one Phira package's fixed slots at a glance.
 *
 * Every fixed note, event, judge-line, hit-effect, and hit-sound slot is a drop
 * target; clicking a slot opens the add/change, reuse, and remove menu. Saving
 * overwrites the identity the board was opened from (the built-in becomes a
 * same-id user override); deleting removes that writable copy after a confirmation.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { InlineAlert } from "../../../../design/components/alert/InlineAlert.tsx";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { Modal } from "../../../../design/components/modal/Modal.tsx";
import {
  DEFAULT_NOTE_SKIN,
  EXTERNAL_NOTE_SKIN_PREFIX,
  loadNoteSkin,
  selectNoteSkin,
  type LoadedNoteSkin,
} from "../../../../core/media/noteSkins.ts";
import {
  buildPhiraWorkbenchFiles,
  phiraHoldAtlasValid,
  phiraWorkbenchDraftFromPack,
  phiraWorkbenchExtrasFromPack,
  type PhiraWorkbenchAsset,
  type PhiraWorkbenchDraft,
  type PhiraWorkbenchSlot,
} from "../../../../core/media/phiraSkinDraft.ts";
import { validatePngDimensions } from "../../../../core/media/noteSkin.ts";
import {
  parsePhiraRespack,
  type ParsedPhiraRespack,
  type PhiraInfo,
} from "../../../../core/media/phiraRespack.ts";
import {
  installPhiraNoteSkin,
  refreshExternalNoteSkins,
  removeInstalledNoteSkin,
} from "../../../../core/platform/desktop/noteSkinPackages.ts";
import { packageName } from "../../../../core/utils/packageName.ts";
import { getLanguage } from "../../../../i18n/index.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import { showToast } from "../../../../design/patterns/ToastHost.tsx";
import { pickFiles } from "../../../platform/filePicker.ts";
import {
  ContextMenuPopup,
  ContextMenuSubmenu,
  createContextMenuState,
  type ContextMenuSnapshot,
} from "../../../overlays/contextMenu/ContextMenuPopup.tsx";
import { MODAL_PRIORITY } from "../../../overlays/modals/modalQueue.ts";
import { requestConfirm, requestExitChoice } from "../../../overlays/modals/prompts.ts";
import { HoldCutter } from "./HoldCutter.tsx";
import { isPhiraPackageTransfer, readDroppedPhiraPackage } from "./phiraPackage.ts";
import { guessHitGrid, guessHoldAtlas, WorkbenchSlotView } from "./SkinWorkbenchSlot.tsx";
import {
  SkinWorkbenchMenu,
  SkinWorkbenchReuseMenu,
  SkinWorkbenchReusePreview,
} from "./SkinWorkbenchMenu.tsx";
import {
  WORKBENCH_SECTIONS,
  WORKBENCH_SLOTS,
  type WorkbenchSlotDefinition,
} from "./skinWorkbenchSlots.ts";
import { useReusableSkins, type ReusableSkinEntry } from "./useReusableSkins.ts";

/** Where the workbench was opened from. */
export type SkinWorkbenchMode = "create" | "edit";

interface WorkbenchMenuSnapshot extends ContextMenuSnapshot {
  readonly slot: PhiraWorkbenchSlot;
}

/** The package identity the board edits: its folder id, kind, and writability. */
interface WorkbenchTarget {
  readonly packageId: string;
  readonly kind: "builtin" | "installed";
  /** `true` when the loaded bytes live in the writable user library. */
  readonly writable: boolean;
}

/**
 * The workbench modal.
 *
 * `create` starts with an empty board; `edit` reads `skinId` and fills every
 * slot the package provides. Closing with unsaved changes asks for a save,
 * discard, or return, and the desktop window close follows the same path.
 */
export function SkinWorkbench({
  mode,
  skinId,
  open,
  onClose,
  onSaved,
}: {
  mode: SkinWorkbenchMode;
  skinId?: string;
  open: boolean;
  onClose(): void;
  onSaved(id: string): void;
}) {
  const { t } = useTranslation();
  const menu = useMemo(() => createContextMenuState<WorkbenchMenuSnapshot>(), []);
  const [draft, setDraft] = useState<PhiraWorkbenchDraft>({});
  const [extras, setExtras] = useState<ReadonlyMap<string, Uint8Array>>(new Map());
  const [name, setName] = useState(() =>
    mode === "create" ? t("settings.skin.workbench.defaultName") : "",
  );
  const [author, setAuthor] = useState("");
  const [baseInfo, setBaseInfo] = useState<PhiraInfo | undefined>();
  const [target, setTarget] = useState<WorkbenchTarget | null>(null);
  const [loading, setLoading] = useState(mode === "edit" && Boolean(skinId));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(open);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reuseMenuSlot, setReuseMenuSlot] = useState<PhiraWorkbenchSlot | null>(null);
  const [reusePreview, setReusePreview] = useState<{ id: string; top: number } | null>(null);
  const [cutSlot, setCutSlot] = useState<PhiraWorkbenchSlot | null>(null);
  const [dropSlot, setDropSlot] = useState<PhiraWorkbenchSlot | null>(null);
  const reusable = useReusableSkins(reuseMenuSlot, mode === "edit" ? skinId : undefined);
  const closePrompt = useRef<Promise<boolean> | null>(null);
  const closeApproved = useRef(false);

  useEffect(() => {
    if (open) {
      closeApproved.current = false;
    }
  }, [open]);

  /** Replace the board with one loaded package. */
  const applyPack = useCallback((pack: LoadedNoteSkin) => {
    setDraft(phiraWorkbenchDraftFromPack(pack));
    setExtras(phiraWorkbenchExtrasFromPack(pack));
    setName(packageName(pack.manifest.name, getLanguage()));
    setAuthor(pack.manifest.phira?.info.author ?? "");
    setBaseInfo(pack.manifest.phira?.info);
    // The loaded pack names the identity to overwrite; the built-in saves a same-id override.
    setTarget(
      pack.packageId
        ? {
            packageId: pack.packageId,
            kind: pack.id === DEFAULT_NOTE_SKIN ? "builtin" : "installed",
            writable: pack.source === "portable",
          }
        : null,
    );
    setError(null);
    setLoadError(null);
    setReuseMenuSlot(null);
    setReusePreview(null);
    setCutSlot(null);
    setDropSlot(null);
    setDirty(false);
    setLoading(false);
  }, []);

  // The parent remounts this workbench when the target changes, so the state
  // above already starts empty for a new skin. Editing reads its package once;
  // the language is read at load time so a live switch keeps the draft.
  useEffect(() => {
    if (mode !== "edit" || !skinId) {
      return undefined;
    }
    let cancelled = false;
    loadNoteSkin(skinId)
      .then((pack) => {
        if (!cancelled) {
          applyPack(pack);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setLoadError(String(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applyPack, mode, skinId]);

  const effectiveLoadError =
    mode === "edit" && !skinId ? "The workbench needs a skin id" : loadError;

  /** Replace one slot. */
  const setAsset = useCallback((slot: PhiraWorkbenchSlot, asset: PhiraWorkbenchAsset) => {
    setDraft((current) => ({ ...current, [slot]: asset }));
    setDirty(true);
    setError(null);
  }, []);

  /** Remove one slot and close any editor that belongs to it. */
  const removeAsset = useCallback((slot: PhiraWorkbenchSlot) => {
    setDraft((current) => {
      const next = { ...current };
      delete next[slot];
      return next;
    });
    setDirty(true);
    setCutSlot((current) => (current === slot ? null : current));
  }, []);

  /** Validate one dropped or picked file and put it in its slot. */
  const acceptFile = useCallback(
    async (slot: PhiraWorkbenchSlot, kind: WorkbenchSlotDefinition["kind"], file: File) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!bytes.length) {
          throw new Error("The selected file is empty");
        }
        if (kind === "sound") {
          // Phira's fixed audio paths are OGG; a renamed MP3 would decode in
          // the webview but not in every client that reads this package.
          if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) {
            throw new Error(t("settings.skin.workbench.file.audio"));
          }
          setAsset(slot, { bytes, fileName: file.name });
          return;
        }
        const { width, height } = validatePngDimensions(bytes);
        if (kind === "hold") {
          const previous = draft[slot];
          const atlas =
            previous?.atlas && previous.atlas[0] + previous.atlas[1] < height
              ? previous.atlas
              : guessHoldAtlas(height);
          setAsset(slot, {
            bytes,
            fileName: file.name,
            width,
            height,
            ...(atlas ? { atlas } : {}),
          });
          setCutSlot(slot);
          return;
        }
        setAsset(slot, {
          bytes,
          fileName: file.name,
          width,
          height,
          ...(kind === "hitFx" ? { grid: guessHitGrid(width, height) } : {}),
        });
      } catch (cause) {
        setError(t("settings.skin.workbench.file.invalid", { message: String(cause) }));
      }
    },
    [draft, setAsset, t],
  );

  /** Open the host picker for one slot. */
  const pickForSlot = useCallback(
    async (definition: WorkbenchSlotDefinition) => {
      const picked = await pickFiles({
        accept: definition.kind === "sound" ? "audio/*" : "image/*",
        multiple: false,
      });
      const file = picked?.[0];
      if (file) {
        await acceptFile(definition.slot, definition.kind, file);
      }
    },
    [acceptFile],
  );

  /** Validate a dropped zip or folder, install it, and open it on the board. */
  const importDroppedPackage = useCallback(
    async (transfer: DataTransfer) => {
      if (busy) {
        return;
      }
      let parsed: ParsedPhiraRespack;
      try {
        parsed = parsePhiraRespack(await readDroppedPhiraPackage(transfer), {
          allowIncomplete: true,
        });
      } catch (cause) {
        showToast({
          message: t("settings.skin.workbench.drop.invalid", { message: String(cause) }),
          level: "warning",
          key: "skin-workbench-import",
        });
        return;
      }
      try {
        const result = await installPhiraNoteSkin(parsed.files, undefined, {
          allowIncomplete: true,
        });
        const importedId = `${EXTERNAL_NOTE_SKIN_PREFIX}${result.id}`;
        await selectNoteSkin(importedId);
        await refreshExternalNoteSkins();
        applyPack(await loadNoteSkin(importedId));
        showToast({
          message: t("settings.skin.workbench.drop.imported", {
            name: packageName(result.name, getLanguage()),
          }),
          key: "skin-workbench-import",
        });
      } catch (cause) {
        showToast({
          message: t("settings.skin.workbench.drop.failed", { message: String(cause) }),
          level: "warning",
          key: "skin-workbench-import",
        });
      }
    },
    [applyPack, busy, t],
  );

  /** Route a drop on one slot to a package import or that slot's asset. */
  const dropSlotTransfer = useCallback(
    (definition: WorkbenchSlotDefinition, transfer: DataTransfer) => {
      if (isPhiraPackageTransfer(transfer)) {
        void importDroppedPackage(transfer);
        return;
      }
      const file = transfer.files[0];
      if (file) {
        void acceptFile(definition.slot, definition.kind, file);
      }
    },
    [acceptFile, importDroppedPackage],
  );

  /** Route a drop outside the slots; only a package is meaningful there. */
  const dropPackageFile = useCallback(
    (event: ReactDragEvent<HTMLElement>) => {
      // Claim every drop so the webview never navigates to the dropped file;
      // only a package changes the board.
      event.preventDefault();
      if (!isPhiraPackageTransfer(event.dataTransfer)) {
        return;
      }
      void importDroppedPackage(event.dataTransfer);
    },
    [importDroppedPackage],
  );

  /** Open the slot menu at the clicked tile without replaying an open menu. */
  const openSlotMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, definition: WorkbenchSlotDefinition) => {
      if (menu.get()?.slot === definition.slot) {
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      setReuseMenuSlot(null);
      setReusePreview(null);
      menu.set({
        owner: event.currentTarget,
        x: rect.left,
        y: rect.bottom + 4,
        slot: definition.slot,
        actions: [],
      });
    },
    [menu],
  );

  const nameValid = name.trim().length > 0 && name.trim().length <= 200;
  const ready = nameValid && !loading && !effectiveLoadError;

  /** Build, overwrite the target identity, and select the saved package. */
  const save = useCallback(async (): Promise<boolean> => {
    if (busy) {
      return false;
    }
    if (!nameValid) {
      setError(t("settings.skin.workbench.nameRequired"));
      return false;
    }
    if (loading || effectiveLoadError) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const files = buildPhiraWorkbenchFiles({
        name,
        draft,
        baseInfo: { ...(baseInfo ?? {}), author: author.trim() || undefined },
        extras,
        allowIncomplete: true,
      });
      const result = await installPhiraNoteSkin(files, target?.packageId, {
        allowIncomplete: true,
      });
      // Only an unchanged built-in id keeps the built-in identity.
      const builtin = target?.kind === "builtin" && result.id === target.packageId;
      await selectNoteSkin(
        builtin ? DEFAULT_NOTE_SKIN : `${EXTERNAL_NOTE_SKIN_PREFIX}${result.id}`,
      );
      await refreshExternalNoteSkins();
      setTarget({
        packageId: result.id,
        kind: builtin ? "builtin" : "installed",
        writable: true,
      });
      setDirty(false);
      onSaved(result.id);
      return true;
    } catch (cause) {
      setError(t("settings.skin.workbench.saveError", { message: String(cause) }));
      return false;
    } finally {
      setBusy(false);
    }
  }, [
    author,
    baseInfo,
    busy,
    draft,
    effectiveLoadError,
    extras,
    loading,
    name,
    nameValid,
    onSaved,
    target,
    t,
  ]);

  /** Close from the footer after the package is written. */
  const handleSave = useCallback(() => {
    void save().then((saved) => {
      if (saved) {
        closeApproved.current = true;
        setVisible(false);
      }
    });
  }, [save]);

  /** Confirm, then delete the writable copy the board was opened from. */
  const deleteSkin = useCallback(async () => {
    if (busy || !target?.writable) {
      return;
    }
    const displayName = name.trim();
    const confirmed = await requestConfirm({
      title: t("settings.skin.workbench.delete.title"),
      description: t("settings.skin.workbench.delete.description", { name: displayName }),
      label: t("settings.skin.workbench.delete.confirm"),
      destructive: true,
      priority: MODAL_PRIORITY.closePrompt,
    });
    if (!confirmed) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeInstalledNoteSkin(target.packageId);
      if (target.kind === "installed") {
        await selectNoteSkin(DEFAULT_NOTE_SKIN);
      }
      setDirty(false);
      closeApproved.current = true;
      showToast({
        message: t("settings.skin.workbench.deleted", { name: displayName }),
        level: "success",
      });
      setVisible(false);
    } catch (cause) {
      setError(t("settings.skin.workbench.delete.failed", { message: String(cause) }));
    } finally {
      setBusy(false);
    }
  }, [busy, name, t, target]);

  /** Ask before closing from the modal, Escape, or the native window close. */
  const requestClose = useCallback((): Promise<boolean> => {
    if (closeApproved.current) {
      return Promise.resolve(true);
    }
    if (busy) {
      return Promise.resolve(false);
    }
    if (closePrompt.current) {
      return closePrompt.current;
    }
    if (!dirty) {
      closeApproved.current = true;
      setVisible(false);
      return Promise.resolve(true);
    }
    const pending = requestExitChoice({
      title: t("settings.skin.workbench.close.title"),
      description: t("settings.skin.workbench.close.description"),
      saveLabel: t("settings.skin.workbench.close.save"),
      discardLabel: t("settings.skin.workbench.close.discard"),
      cancelLabel: t("settings.skin.workbench.close.cancel"),
      priority: MODAL_PRIORITY.closePrompt,
    }).then(async (choice) => {
      if (choice === "cancel") {
        return false;
      }
      if (choice === "save" && !(await save())) {
        return false;
      }
      closeApproved.current = true;
      setVisible(false);
      return true;
    });
    closePrompt.current = pending.finally(() => {
      closePrompt.current = null;
    });
    return closePrompt.current;
  }, [busy, dirty, save, t]);

  useEffect(() => () => menu.set(null), [menu]);

  /** Fill one reusable asset into the submenu's slot. */
  const reusePicked = useCallback(
    (entry: ReusableSkinEntry) => {
      if (!reuseMenuSlot) {
        return;
      }
      setAsset(reuseMenuSlot, { ...entry.asset, source: entry.label });
      if (
        (reuseMenuSlot === "hold" || reuseMenuSlot === "hold_highlight") &&
        !phiraHoldAtlasValid(entry.asset)
      ) {
        setCutSlot(reuseMenuSlot);
      }
      setReuseMenuSlot(null);
      setReusePreview(null);
      menu.set(null);
    },
    [menu, reuseMenuSlot, setAsset],
  );

  /** Update one hit-effect grid axis while keeping the other. */
  const changeGrid = useCallback(
    (slot: PhiraWorkbenchSlot, axis: 0 | 1, raw: string) => {
      const asset = draft[slot];
      if (!asset) {
        return;
      }
      const grid = asset.grid ?? [1, 1];
      const value = Math.max(1, Math.floor(Number(raw) || 1));
      setAsset(slot, {
        ...asset,
        grid: axis === 0 ? [value, grid[1]] : [grid[0], value],
      });
    },
    [draft, setAsset],
  );

  /** Update one Hold cut boundary while keeping the other. */
  const changeAtlas = useCallback(
    (slot: PhiraWorkbenchSlot, axis: 0 | 1, raw: string) => {
      const asset = draft[slot];
      if (!asset) {
        return;
      }
      const atlas = asset.atlas ?? [0, 0];
      const value = Math.max(0, Math.floor(Number(raw) || 0));
      setAsset(slot, {
        ...asset,
        atlas: axis === 0 ? [value, atlas[1]] : [atlas[0], value],
      });
    },
    [draft, setAsset],
  );

  /** Render one section of slot tiles. */
  const renderSection = (section: (typeof WORKBENCH_SECTIONS)[number], className = "") => (
    <section
      className={`redux-skin-workbench-section${className ? ` ${className}` : ""}`}
      key={section.id}
      data-section={section.id}
      aria-label={t(section.title)}
    >
      <div className="redux-skin-workbench-grid">
        {section.slots.map((definition) => {
          const asset = draft[definition.slot];
          return (
            <WorkbenchSlotView
              key={definition.slot}
              definition={definition}
              asset={asset}
              dragActive={dropSlot === definition.slot}
              onOpenMenu={(event) => openSlotMenu(event, definition)}
              isMenuOpen={() => menu.get()?.slot === definition.slot}
              onDropTransfer={(transfer) => dropSlotTransfer(definition, transfer)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDropSlot(definition.slot);
                }
              }}
              onDragLeave={(event) => {
                const related = event.relatedTarget;
                if (!(related instanceof Node) || !event.currentTarget.contains(related)) {
                  setDropSlot((current) => (current === definition.slot ? null : current));
                }
              }}
              onGridChange={(axis, value) => changeGrid(definition.slot, axis, value)}
              onAtlasChange={(axis, value) => changeAtlas(definition.slot, axis, value)}
            />
          );
        })}
      </div>
    </section>
  );

  const [notesSection, eventSection, judgelineSection, effectsSection, soundsSection] =
    WORKBENCH_SECTIONS;
  const cutAsset = cutSlot ? draft[cutSlot] : undefined;
  const reuseDefinition = reuseMenuSlot
    ? WORKBENCH_SLOTS.find((definition) => definition.slot === reuseMenuSlot)
    : undefined;
  const reusePreviewEntry = reusePreview
    ? reusable.entries.find((entry) => entry.id === reusePreview.id)
    : undefined;

  return (
    <Modal
      open={visible}
      onClose={() => void requestClose()}
      onClosed={onClose}
      requestClose={requestClose}
      label={t("settings.skin.workbench.title")}
      className="redux-skin-workbench-dialog"
      actions={
        <>
          {mode === "edit" && target && (
            <Button
              variant="danger"
              disabled={busy || !target.writable}
              onClick={() => void deleteSkin()}
            >
              {t("settings.skin.workbench.delete")}
            </Button>
          )}
          <Button variant="solid" disabled={busy || !ready} onClick={handleSave}>
            {busy ? t("settings.skin.workbench.saving") : t("settings.skin.workbench.save")}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="redux-skin-workbench-loading">{t("settings.skin.workbench.loading")}</p>
      ) : effectiveLoadError ? (
        <InlineAlert className="redux-skin-workbench-alert">
          {t("settings.skin.workbench.loadError", { message: effectiveLoadError })}
        </InlineAlert>
      ) : (
        <div
          className="redux-skin-workbench"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
            }
          }}
          onDrop={dropPackageFile}
        >
          <div className="redux-skin-workbench-fields">
            <FieldRow
              className="redux-skin-workbench-field"
              density="compact"
              htmlFor="skin-workbench-name"
              label={t("settings.skin.workbench.name.label")}
              control={
                <Input
                  id="skin-workbench-name"
                  value={name}
                  maxLength={200}
                  textAlign="left"
                  placeholder={t("settings.skin.workbench.name.placeholder")}
                  onChange={(event) => {
                    setName(event.target.value);
                    setDirty(true);
                  }}
                />
              }
            />
            <FieldRow
              className="redux-skin-workbench-field"
              density="compact"
              htmlFor="skin-workbench-author"
              label={t("settings.skin.workbench.author.label")}
              control={
                <Input
                  id="skin-workbench-author"
                  value={author}
                  maxLength={200}
                  textAlign="left"
                  onChange={(event) => {
                    setAuthor(event.target.value);
                    setDirty(true);
                  }}
                />
              }
            />
          </div>
          {error && <InlineAlert className="redux-skin-workbench-alert">{error}</InlineAlert>}
          {renderSection(notesSection)}
          <div className="redux-skin-workbench-triptych">
            {renderSection(eventSection)}
            {renderSection(judgelineSection)}
            {renderSection(effectsSection)}
          </div>
          {renderSection(soundsSection)}
          {cutSlot && cutAsset && (
            <HoldCutter
              key={`${cutSlot}:${cutAsset.fileName}:${cutAsset.bytes.byteLength}`}
              asset={cutAsset}
              onApply={(atlas) => {
                setAsset(cutSlot, { ...cutAsset, atlas });
                setCutSlot(null);
              }}
              onCancel={() => setCutSlot(null)}
            />
          )}
        </div>
      )}
      <ContextMenuPopup
        store={menu}
        label={t("settings.skin.workbench.slotMenu")}
        className="redux-skin-workbench-menu"
        submenu={
          reuseDefinition ? (
            <ContextMenuSubmenu
              label={t("settings.skin.workbench.reuse.label", {
                name: t(reuseDefinition.label),
              })}
              loading={reusable.loading}
              preview={
                reusePreviewEntry ? (
                  <SkinWorkbenchReusePreview
                    entry={reusePreviewEntry}
                    definition={reuseDefinition}
                  />
                ) : undefined
              }
              previewTop={reusePreview?.top ?? 0}
              onClose={() => {
                setReuseMenuSlot(null);
                setReusePreview(null);
              }}
            >
              <SkinWorkbenchReuseMenu
                definition={reuseDefinition}
                loading={reusable.loading}
                failed={reusable.failed}
                entries={reusable.entries}
                activeId={reusePreview?.id ?? null}
                onPreview={(entry, top) => setReusePreview({ id: entry.id, top })}
                onPreviewEnd={() => setReusePreview(null)}
                onPick={reusePicked}
              />
            </ContextMenuSubmenu>
          ) : null
        }
      >
        {(snapshot, close) => {
          const definition = WORKBENCH_SLOTS.find((candidate) => candidate.slot === snapshot.slot);
          if (!definition) {
            return null;
          }
          return (
            <SkinWorkbenchMenu
              definition={definition}
              asset={draft[snapshot.slot]}
              reuseOpen={reuseMenuSlot === snapshot.slot}
              onPick={() => void pickForSlot(definition)}
              onCut={() => {
                setReuseMenuSlot(null);
                setReusePreview(null);
                setCutSlot(snapshot.slot);
              }}
              onReuse={() => {
                setCutSlot(null);
                setReusePreview(null);
                setReuseMenuSlot((current) => (current === snapshot.slot ? null : snapshot.slot));
              }}
              onRemove={() => removeAsset(snapshot.slot)}
              close={close}
            />
          );
        }}
      </ContextMenuPopup>
    </Modal>
  );
}
