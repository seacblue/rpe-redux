/**
 * The workbench slot menu and the reuse submenu rows.
 *
 * Reuse is a true second-level menu: the parent stays open and the submenu
 * names each installed skin. The asset thumbnail is a non-interactive floating
 * card that follows the hovered row, so the list itself stays one column of
 * names and the pointer never lands on the preview.
 */
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { MenuItem, MenuSeparator } from "../../../../design/components/menu/MenuSurface.tsx";
import type { PhiraWorkbenchAsset } from "../../../../core/media/phiraSkinDraft.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import type { ReusableSkinEntry } from "./useReusableSkins.ts";
import { useObjectUrl } from "./workbenchMedia.tsx";
import type { WorkbenchSlotDefinition } from "./skinWorkbenchSlots.ts";

/** One slot's main actions; the reuse row opens the sibling submenu. */
export function SkinWorkbenchMenu({
  definition,
  asset,
  reuseOpen,
  onPick,
  onCut,
  onReuse,
  onRemove,
  close,
}: {
  definition: WorkbenchSlotDefinition;
  asset: PhiraWorkbenchAsset | undefined;
  reuseOpen: boolean;
  onPick(): void;
  onCut(): void;
  /** Toggle the sibling reuse submenu without replacing this menu. */
  onReuse(): void;
  onRemove(): void;
  close(): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <MenuItem
        label={t(asset ? "settings.skin.workbench.replace" : "settings.skin.workbench.add")}
        icon={<Icon name="image" size={14} />}
        onClick={() => {
          close();
          onPick();
        }}
      />
      {definition.kind === "hold" && asset ? (
        <MenuItem
          label={t("settings.skin.workbench.cut.action")}
          icon={<Icon name="cut" size={14} />}
          onClick={() => {
            close();
            onCut();
          }}
        />
      ) : null}
      <MenuItem
        label={t("settings.skin.workbench.reuse.action")}
        icon={<Icon name="copy" size={14} />}
        expandable
        expanded={reuseOpen}
        onClick={onReuse}
      />
      {asset ? (
        <>
          <MenuSeparator />
          <MenuItem
            label={t("settings.skin.workbench.remove")}
            icon={<Icon name="trash" size={14} />}
            danger
            onClick={() => {
              close();
              onRemove();
            }}
          />
        </>
      ) : null}
    </>
  );
}

/** The floating card that previews the hovered asset beside the submenu. */
export function SkinWorkbenchReusePreview({
  entry,
  definition,
}: {
  entry: ReusableSkinEntry;
  definition: WorkbenchSlotDefinition;
}) {
  const url = useObjectUrl(definition.kind === "sound" ? null : entry.asset.bytes, "image/png");
  if (definition.kind === "sound" || !url) {
    return (
      <span className="redux-skin-workbench-reuse-preview-glyph">
        <Icon name={definition.kind === "sound" ? "music" : "image"} size={32} />
      </span>
    );
  }
  return (
    <img className="redux-skin-workbench-reuse-preview-image" src={url} alt="" decoding="async" />
  );
}

/** The sibling menu: one row per installed skin that provides this slot. */
export function SkinWorkbenchReuseMenu({
  definition,
  loading,
  failed,
  entries,
  activeId,
  onPreview,
  onPreviewEnd,
  onPick,
}: {
  definition: WorkbenchSlotDefinition;
  loading: boolean;
  failed: boolean;
  entries: readonly ReusableSkinEntry[];
  /** The entry whose floating preview is currently shown. */
  activeId: string | null;
  onPreview(entry: ReusableSkinEntry, top: number): void;
  onPreviewEnd(): void;
  onPick(entry: ReusableSkinEntry): void;
}) {
  const { t } = useTranslation();
  if (loading) {
    return <MenuItem label={t("settings.skin.workbench.reuse.loading")} disabled />;
  }
  if (entries.length === 0) {
    return (
      <MenuItem
        label={t(
          failed ? "settings.skin.workbench.reuse.failed" : "settings.skin.workbench.reuse.empty",
        )}
        disabled
      />
    );
  }
  /** Place the preview card level with the row that the pointer entered. */
  const show = (entry: ReusableSkinEntry, target: HTMLButtonElement) => {
    const submenu = target.closest(".redux-menu-submenu");
    const row = target.getBoundingClientRect();
    const anchor = submenu?.getBoundingClientRect();
    onPreview(entry, anchor ? row.top - anchor.top : 0);
  };
  return (
    <div className="redux-skin-workbench-reuse-list" onPointerLeave={onPreviewEnd}>
      {entries.map((entry) => (
        <MenuItem
          key={entry.id}
          label={entry.label}
          className={activeId === entry.id ? "is-previewing" : ""}
          onPointerEnter={(event) => show(entry, event.currentTarget)}
          onClick={() => onPick(entry)}
        />
      ))}
    </div>
  );
}
