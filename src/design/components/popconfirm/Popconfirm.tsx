/**
 * A small confirmation popover anchored to the control that opened it.
 *
 * Popconfirm is deliberately not a modal: it does not create a `<dialog>`, does
 * not inert the workspace, and does not join the modal stack. It is for
 * reversible, local decisions where a full modal would interrupt the task. The
 * shared anchored-popover hook owns placement, dismissal, Escape, and tracking;
 * this component owns only the confirmation content and focus handoff.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../button/Button.tsx";
import { useAnchoredPopover } from "../../patterns/useAnchoredPopover.ts";
import { useTranslation } from "../../../i18n/react.ts";

export interface PopconfirmProps {
  open: boolean;
  /** The button, row, or field that owns this decision. */
  anchor: HTMLElement | null;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
  className?: string;
}

const EXIT_MS = 160;

/** A non-modal, origin-aware confirmation for frequent inline actions. */
export function Popconfirm({
  open,
  anchor,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
  className,
}: PopconfirmProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const descriptionId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  // The hook takes a ref; the prop is the element itself because callers own it.
  const anchorRef = useMemo<RefObject<HTMLElement | null>>(() => ({ current: anchor }), [anchor]);

  useEffect(() => {
    let first = 0;
    let second = 0;
    let hide = 0;
    let timer = 0;
    if (open && anchor) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : anchor;
      // Two frames let the portal paint once before the enter transition starts;
      // doing this in a callback also keeps the effect body free of synchronous
      // state updates.
      first = requestAnimationFrame(() => {
        setMounted(true);
        second = requestAnimationFrame(() => setShown(true));
      });
    } else {
      hide = requestAnimationFrame(() => setShown(false));
      timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    }
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      cancelAnimationFrame(hide);
      window.clearTimeout(timer);
    };
  }, [anchor, open]);

  const { style, side } = useAnchoredPopover({
    open: open && mounted,
    anchor: anchorRef,
    panel: ref,
    onClose: onCancel,
    align: "center",
    gap: 8,
    // A confirmation owns the click that dismisses it; otherwise the settings
    // scrim would also see the same pointerdown and close the whole window.
    blockOutsidePointer: true,
  });

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const initial =
      ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? cancelRef.current;
    initial?.focus({ preventScroll: true });
    return () => {
      if (returnFocus.current?.isConnected) {
        returnFocus.current.focus({ preventScroll: true });
      }
    };
  }, [mounted]);

  if (!mounted || !anchor) {
    return null;
  }
  // Keep the popover inside the app root (or the dialog that owns the anchor):
  // design inputs are qualified with `.redux-app-root`, and a body portal inside a modal
  // dialog would also be inert.
  const host =
    anchor.closest("dialog[open]") ??
    anchor.closest(".redux-app-root") ??
    anchor.ownerDocument.body;
  return createPortal(
    <div
      ref={ref}
      className={`redux-popconfirm ${className ?? ""}`}
      data-state={shown ? "open" : "closing"}
      data-placement={side}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      style={
        {
          ...style,
          visibility: mounted ? "visible" : "hidden",
          "--popconfirm-origin-x": style["--popover-origin-x"],
          "--popconfirm-origin-y": style["--popover-origin-y"],
        } as CSSProperties
      }
    >
      <div className="redux-popconfirm-heading">
        <strong id={titleId}>{title}</strong>
      </div>
      {description && (
        <p className="redux-popconfirm-description" id={descriptionId}>
          {description}
        </p>
      )}
      {children}
      <div className="redux-popconfirm-actions">
        <Button ref={cancelRef} variant="outlined" size="sm" onClick={onCancel}>
          {cancelLabel ?? t("common.action.cancel")}
        </Button>
        <Button variant={destructive ? "danger" : "solid"} size="sm" onClick={onConfirm}>
          {confirmLabel ?? t("common.action.confirm")}
        </Button>
      </div>
    </div>,
    host,
  );
}
