/**
 * One workbench slot tile and the geometry checks that the board and the tile
 * share. The tile owns only its own preview, drop target, and per-kind numeric
 * editors; package assembly stays in `core/media/phiraSkinDraft.ts`.
 */
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import {
  phiraHitGridValid,
  phiraHoldAtlasValid,
  type PhiraWorkbenchAsset,
} from "../../../../core/media/phiraSkinDraft.ts";
import { useTranslation } from "../../../../i18n/react.ts";
import type { WorkbenchSlotDefinition } from "./skinWorkbenchSlots.ts";
import { AssetPreview, SoundToggle } from "./workbenchMedia.tsx";

/** The smallest atlas split the cutter previews when a Hold is first added. */
export function guessHoldAtlas(height: number): [number, number] | undefined {
  const tail = Math.max(1, Math.floor(height / 3));
  const head = Math.max(1, Math.floor((height - tail) / 2));
  return tail + head < height ? [tail, head] : undefined;
}

/** A first guess at a hit-effect frame grid; the author can change it. */
export function guessHitGrid(width: number, height: number): [number, number] {
  if (width % 8 === 0 && height % 4 === 0) {
    return [8, 4];
  }
  if (width % 4 === 0 && height % 4 === 0) {
    return [4, 4];
  }
  return [1, 1];
}

/** A single slot tile: empty plus, filled preview, and per-kind editors. */
export function WorkbenchSlotView({
  definition,
  asset,
  dragActive,
  onOpenMenu,
  isMenuOpen,
  onDropTransfer,
  onDragOver,
  onDragLeave,
  onGridChange,
  onAtlasChange,
}: {
  definition: WorkbenchSlotDefinition;
  asset: PhiraWorkbenchAsset | undefined;
  dragActive: boolean;
  onOpenMenu(event: ReactMouseEvent<HTMLButtonElement>): void;
  /** True while this slot's menu is open; a second click closes it. */
  isMenuOpen(): boolean;
  onDropTransfer(transfer: DataTransfer): void;
  onDragOver(event: ReactDragEvent<HTMLElement>): void;
  onDragLeave(event: ReactDragEvent<HTMLElement>): void;
  onGridChange(axis: 0 | 1, value: string): void;
  onAtlasChange(axis: 0 | 1, value: string): void;
}) {
  const { t } = useTranslation();
  const label = t(definition.label);
  const badAtlas = definition.kind === "hold" && asset !== undefined && !phiraHoldAtlasValid(asset);
  const badGrid = definition.kind === "hitFx" && asset !== undefined && !phiraHitGridValid(asset);
  return (
    <article
      className={`redux-skin-workbench-slot${asset ? " is-filled" : " is-empty"}${
        dragActive ? " is-drop-target" : ""
      }${badAtlas || badGrid ? " is-invalid" : ""}`}
      data-slot={definition.slot}
      data-filled={asset ? "true" : "false"}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragLeave(event);
        onDropTransfer(event.dataTransfer);
      }}
    >
      <div className="redux-skin-workbench-slot-heading">
        <span>{label}</span>
        {definition.kind === "sound" && asset ? (
          <SoundToggle
            asset={asset}
            playLabel={t("settings.skin.workbench.play")}
            pauseLabel={t("settings.skin.workbench.pause")}
          />
        ) : null}
      </div>
      <Button
        variant="plain"
        className="redux-skin-workbench-media"
        aria-label={
          asset
            ? t("settings.skin.workbench.replaceNamed", { name: label })
            : t("settings.skin.workbench.addNamed", { name: label })
        }
        onPointerDown={(event) => {
          if (isMenuOpen()) {
            event.preventDefault();
          }
        }}
        onClickCapture={(event) => {
          if (isMenuOpen()) {
            event.preventDefault();
          }
        }}
        onClick={onOpenMenu}
      >
        {asset ? (
          <AssetPreview asset={asset} kind={definition.kind} />
        ) : (
          <span className="redux-skin-workbench-plus">
            <Icon name="plus" size={28} />
            <span>{t("settings.skin.workbench.drop")}</span>
          </span>
        )}
      </Button>
      {definition.kind === "hold" && asset ? (
        <div className="redux-skin-workbench-grid-fields">
          <label>
            <span>{t("settings.skin.workbench.cut.tail")}</span>
            <Input
              type="number"
              min={1}
              value={asset.atlas?.[0] || ""}
              onChange={(event) => onAtlasChange(0, event.target.value)}
            />
          </label>
          <label>
            <span>{t("settings.skin.workbench.cut.head")}</span>
            <Input
              type="number"
              min={1}
              value={asset.atlas?.[1] || ""}
              onChange={(event) => onAtlasChange(1, event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {definition.kind === "hitFx" && asset ? (
        <div className="redux-skin-workbench-grid-fields">
          <label>
            <span>{t("settings.skin.workbench.hitFx.columns")}</span>
            <Input
              type="number"
              min={1}
              value={asset.grid?.[0] ?? 1}
              onChange={(event) => onGridChange(0, event.target.value)}
            />
          </label>
          <label>
            <span>{t("settings.skin.workbench.hitFx.rows")}</span>
            <Input
              type="number"
              min={1}
              value={asset.grid?.[1] ?? 1}
              onChange={(event) => onGridChange(1, event.target.value)}
            />
          </label>
        </div>
      ) : null}
      {badAtlas && (
        <span className="redux-skin-workbench-error">
          {t("settings.skin.workbench.cut.missing")}
        </span>
      )}
      {badGrid && (
        <span className="redux-skin-workbench-error">
          {t("settings.skin.workbench.hitFx.invalid")}
        </span>
      )}
    </article>
  );
}
