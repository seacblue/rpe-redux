/**
 * Texture field and popover for the judgement-line curve.
 *
 * Textures are chosen by sight, so the field opens a compact listbox styled like
 * the shared dropdowns instead of the text-only select. Selecting a tile writes
 * through immediately; adding images stays in the same popover.
 */
import { useEffect, useRef, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { EmptyState } from "../../../../../design/components/empty-state/EmptyState.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { AsyncImage } from "../../../../../design/components/image/AsyncImage.tsx";
import { ListRow } from "../../../../../design/components/list/ListRow.tsx";
import { useListbox } from "../../../../../design/patterns/list/useListbox.ts";
import { useAnchoredPopover } from "../../../../../design/patterns/useAnchoredPopover.ts";
import { useAppRootHost } from "../../../../../design/patterns/portalHost.tsx";
import { t } from "../../../../../i18n/index.ts";
import type { LinePanelTexture } from "./linePanelController.ts";

/** Props for the compact texture trigger field. */
export interface TextureFieldProps {
  id: string;
  textures: readonly LinePanelTexture[];
  /** The texture currently written on the selected judge line. */
  value: string;
  /** The selection disagrees; show the mixed label and no single thumbnail. */
  mixed?: boolean;
  open: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onToggle(): void;
}

/** The compact field row that opens the texture listbox. */
export function TextureField({
  id,
  textures,
  value,
  mixed = false,
  open,
  triggerRef,
  onToggle,
}: TextureFieldProps) {
  const current = textures.find((texture) => texture.name === value);
  const label = mixed ? t("editorPanels.linePanel.mixed") : value;
  return (
    <div className="line-texture-field">
      <Button
        id={id}
        ref={triggerRef}
        type="button"
        variant="plain"
        className="line-texture-trigger"
        aria-expanded={open}
        aria-controls={`${id}-browser`}
        aria-label={`${t("editorPanels.linePanel.texture")}: ${label}`}
        onClick={onToggle}
      >
        {!mixed && current?.url ? (
          <TextureThumb url={current.url} className="line-texture-thumb" />
        ) : (
          <span className="line-texture-thumb" aria-hidden="true">
            <Icon name="image" size={16} />
          </span>
        )}
        <span className="line-texture-name">{label}</span>
        <span className={`line-texture-caret${open ? " open" : ""}`} aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Props for the floating texture listbox. */
export interface TextureBrowserProps {
  id: string;
  textures: readonly LinePanelTexture[];
  value: string;
  onChange(name: string): void;
  /** Opens the image picker; resolves with the asset keys it added, if any. */
  onAddTexture(): Promise<string[]>;
  onClose(): void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const POPOVER_MAX_HEIGHT = 380;
const POPOVER_GAP = 6;
/** One texture preview that keeps the shared shimmer visible until decode. */
function TextureThumb({ url, className }: { url: string; className: string }) {
  return (
    <span className={className} aria-hidden="true">
      <AsyncImage src={url} loading="lazy" decoding="async" />
    </span>
  );
}

/**
 * The texture listbox.
 *
 * It is a portal pinned to the trigger, not a sibling panel: the inspector stays
 * one column and the list floats over the surface like every other dropdown.
 */
export function TextureBrowser({
  id,
  textures,
  value,
  onChange,
  onAddTexture,
  onClose,
  triggerRef,
}: TextureBrowserProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<number, HTMLElement>());
  const selectedIndex = textures.findIndex((texture) => texture.name === value);
  const listbox = useListbox({
    count: textures.length,
    selected: selectedIndex,
    onSelect: (index) => {
      const texture = textures[index];
      if (texture && texture.name !== value) {
        onChange(texture.name);
      }
    },
    idPrefix: `${id}-option`,
  });
  const portalTarget = useAppRootHost() ?? document.body;
  const popover = useAnchoredPopover({
    open: true,
    anchor: triggerRef,
    panel: popoverRef,
    onClose,
    gap: POPOVER_GAP,
    matchAnchorWidth: true,
    maxHeight: POPOVER_MAX_HEIGHT,
    focusTarget: triggerRef,
  });

  useEffect(() => {
    const selected = selectedIndex >= 0 ? optionRefs.current.get(selectedIndex) : undefined;
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      className="line-texture-popover"
      style={popover.style}
      data-placement={popover.side}
      data-texture-popover
    >
      <div
        ref={listRef}
        className="line-texture-popover-list"
        role="listbox"
        aria-label={t("editorPanels.linePanel.texturePicker")}
        {...listbox.listProps}
      >
        {textures.length === 0 ? (
          <EmptyState
            variant="inline"
            title={t("editorPanels.linePanel.textureEmpty")}
            className="line-texture-empty"
          />
        ) : (
          textures.map((texture, index) => {
            const selected = texture.name === value;
            return (
              <ListRow
                as="button"
                type="button"
                key={texture.name}
                ref={(option) => {
                  if (option) {
                    optionRefs.current.set(index, option);
                  } else {
                    optionRefs.current.delete(index);
                  }
                }}
                selected={selected}
                className="line-texture-option"
                {...listbox.optionProps(index)}
              >
                {texture.url ? (
                  <TextureThumb url={texture.url} className="line-texture-option-thumb" />
                ) : (
                  <span className="line-texture-option-thumb" aria-hidden="true">
                    <Icon name="image" size={16} />
                  </span>
                )}
                <span className="line-texture-option-name">{texture.name}</span>
              </ListRow>
            );
          })
        )}
      </div>
      <div className="line-texture-popover-footer">
        <Button
          type="button"
          variant="outlined"
          className="line-texture-add"
          onClick={() => {
            void onAddTexture().then((added) => {
              if (added.length) {
                onChange(added[0]);
              }
            });
          }}
        >
          <Icon name="plus" size={16} />
          {t("editorPanels.linePanel.addTexture")}
        </Button>
      </div>
    </div>,
    portalTarget,
  );
}
