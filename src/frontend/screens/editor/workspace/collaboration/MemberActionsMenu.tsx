/**
 * Overflow actions for one room member.
 *
 * The trigger stays hidden until the row is hovered or receives focus, then
 * opens a compact menu instead of keeping access and dismissal controls visible
 * all the time.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { IconButton } from "../../../../../design/components/button/IconButton.tsx";
import {
  MenuItem,
  MenuSeparator,
  MenuSurface,
} from "../../../../../design/components/menu/MenuSurface.tsx";
import { useAnchoredPopover } from "../../../../../design/patterns/useAnchoredPopover.ts";
import { useTranslation } from "../../../../../i18n/react.ts";

/** Actions offered by the member overflow menu. */
export interface MemberActionsMenuProps {
  readonly memberName: string;
  onChangeAccess(): void;
  onKick(): void;
}

/** Hover/focus-revealed member action menu. */
export function MemberActionsMenu({ memberName, onChangeAccess, onKick }: MemberActionsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const { style, side } = useAnchoredPopover({
    open,
    anchor,
    panel,
    onClose: () => setOpen(false),
    align: "end",
    gap: 4,
    toggle: anchor,
    blockOutsidePointer: true,
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({
        preventScroll: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const close = () => setOpen(false);
  const run = (action: () => void) => {
    close();
    action();
  };
  const toggle = () => {
    if (!open && anchor.current) {
      setPortalHost(
        anchor.current.closest<HTMLElement>(".redux-app-root") ?? anchor.current.ownerDocument.body,
      );
    }
    setOpen((current) => !current);
  };
  return (
    <>
      <span className="collab-member-actions" data-open={open ? "true" : "false"}>
        <IconButton
          ref={anchor}
          size="md"
          icon="more"
          label={t("workspace.collaboration.memberActions", { name: memberName })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
        />
      </span>
      {open && portalHost
        ? createPortal(
            <div ref={panel} className="collab-member-menu" data-placement={side} style={style}>
              <MenuSurface label={t("workspace.collaboration.memberActions", { name: memberName })}>
                <MenuItem
                  icon={<Icon name="shield" size={14} />}
                  label={t("workspace.collaboration.changeAccess")}
                  onClick={() => run(onChangeAccess)}
                />
                <MenuSeparator />
                <MenuItem
                  danger
                  icon={<Icon name="trash" size={14} />}
                  label={t("workspace.collaboration.kick")}
                  onClick={() => run(onKick)}
                />
              </MenuSurface>
            </div>,
            portalHost,
          )
        : null}
    </>
  );
}
