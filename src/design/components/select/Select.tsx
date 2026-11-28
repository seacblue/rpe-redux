/**
 * Select primitive that swaps Chromium's unstylable native list for the
 * design-system dropdown while keeping the real `<select>` as the value holder.
 * Callers own options and change handling.
 */
import {
  useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
  type SelectHTMLAttributes,
} from "react";
import { editableSelect, openControlSelect } from "../../controls/controlActions.ts";
import { getPopup, subscribePopup } from "../../controls/controlActions.ts";
import { Icon } from "../icon/Icon.tsx";

/** Where the selected value sits inside the closed control. */
export type SelectTextAlign = "left" | "center" | "right";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  "data-tip-title"?: string;
  /**
   * Inner text alignment. A select reads as a list, so it keeps the leading
   * edge by default; a compact toolbar cell names its own edge explicitly.
   */
  textAlign?: SelectTextAlign;
};

/** A native `<select>` that opens the design-system list while keeping its value. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = "", textAlign = "left", title, ...props },
  ref,
) {
  const element = useRef<HTMLSelectElement>(null);
  const pressed = useRef(false);
  const clearPressed = useRef<number | undefined>(undefined);
  const popup = useSyncExternalStore(subscribePopup, getPopup, getPopup);
  const expanded = popup?.kind === "select" && popup.element === element.current;
  const openFromPointer = useCallback((select: HTMLSelectElement) => {
    select.focus({ preventScroll: true });
    pressed.current = true;
    window.clearTimeout(clearPressed.current);
    clearPressed.current = window.setTimeout(() => {
      pressed.current = false;
      clearPressed.current = undefined;
    }, 1000);
    openControlSelect(select);
  }, []);
  useImperativeHandle(ref, () => {
    const select = element.current;
    if (!select) {
      throw new Error("Select element is unavailable while binding its ref");
    }
    return select;
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(clearPressed.current);
    },
    [],
  );
  useEffect(() => {
    const select = element.current;
    if (!select) {
      return;
    }
    const labels = [...(select.labels ?? [])];
    const activate = (event: MouseEvent) => {
      if (event.defaultPrevented || !editableSelect(select)) {
        return;
      }
      // Label activation is intercepted so Chromium's native list never opens.
      event.preventDefault();
      openFromPointer(select);
    };
    for (const label of labels) {
      label.addEventListener("mousedown", activate);
    }
    return () => {
      for (const label of labels) {
        label.removeEventListener("mousedown", activate);
      }
    };
  }, [openFromPointer, props.disabled, props.multiple, props.size]);
  return (
    <span className="redux-select-shell">
      <select
        ref={element}
        className={`redux-select ${className}`}
        {...props}
        autoComplete="off"
        data-text-align={textAlign}
        data-tip-title={props["data-tip-title"] ?? title}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        onMouseDown={(event) => {
          props.onMouseDown?.(event);
          const select = event.currentTarget;
          if (event.defaultPrevented || !editableSelect(select)) {
            return;
          }
          event.preventDefault();
          openFromPointer(select);
        }}
        onClick={(event) => {
          props.onClick?.(event);
          const select = event.currentTarget;
          if (event.defaultPrevented || !editableSelect(select)) {
            return;
          }
          event.preventDefault();
          if (pressed.current) {
            pressed.current = false;
            window.clearTimeout(clearPressed.current);
            clearPressed.current = undefined;
            return;
          }
          if (getPopup()?.element !== select) {
            select.focus({ preventScroll: true });
            openControlSelect(select);
          }
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          const select = event.currentTarget;
          if (event.defaultPrevented || getPopup() || !editableSelect(select)) {
            return;
          }
          if (["Enter", " "].includes(event.key)) {
            event.preventDefault();
            openControlSelect(select);
          }
        }}
      />
      <Icon name="chevronDown" size={14} className="redux-select-chevron" />
    </span>
  );
});
