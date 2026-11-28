/**
 * Design-system multi-select: a button-shaped control with an anchored,
 * checkbox-backed listbox. The component owns the control geometry, popup
 * placement, dismissal, and motion; callers own option labels and selection rules.
 */
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "../button/Button.tsx";
import { Input } from "../input/Input.tsx";
import { useAnchoredPopover } from "../../patterns/useAnchoredPopover.ts";
import { useOverlayHost } from "../../patterns/portalHost.tsx";

/** One option in a design multi-select. */
export interface MultiSelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface MultiSelectProps {
  /** Stable id for the trigger; generated when omitted. */
  id?: string;
  /** Currently selected option values. */
  value: readonly string[];
  /** Options shown in the listbox, in caller-defined order. */
  options: readonly MultiSelectOption[];
  /** Receives the next selection without applying any caller-specific rules. */
  onChange(value: string[]): void;
  /** Content shown in the closed control when the selection is empty. */
  placeholder?: ReactNode;
  /** Optional accessible name for the trigger. */
  "aria-label"?: string;
  disabled?: boolean;
  className?: string;
}

const EXIT_MS = 180;

function selectedSummary(
  value: readonly string[],
  options: readonly MultiSelectOption[],
): ReactNode {
  const labels = value.map(
    (selectedValue) =>
      options.find((option) => option.value === selectedValue)?.label ?? selectedValue,
  );
  return labels.map((label, index) => (
    <Fragment key={`${value[index]}:${index}`}>
      {index > 0 ? ", " : null}
      {label}
    </Fragment>
  ));
}

/** A reusable design-system multi-select control. */
export function MultiSelect({
  id,
  value,
  options,
  onChange,
  placeholder,
  "aria-label": ariaLabel,
  disabled = false,
  className = "",
}: MultiSelectProps) {
  const generatedId = useId().replaceAll(":", "");
  const controlId = id ?? `redux-multi-select-${generatedId}`;
  const panelId = `${controlId}-options`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayHost = useOverlayHost();
  const [fallbackHost] = useState<HTMLElement | null>(() =>
    typeof document === "undefined" ? null : document.body,
  );
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const selected = new Set(value);

  useEffect(() => {
    let enterFrame = 0;
    let shownFrame = 0;
    let exitTimer = 0;
    if (open) {
      enterFrame = requestAnimationFrame(() => {
        setMounted(true);
        shownFrame = requestAnimationFrame(() => setShown(true));
      });
    } else {
      shownFrame = requestAnimationFrame(() => setShown(false));
      exitTimer = window.setTimeout(() => setMounted(false), EXIT_MS);
    }
    return () => {
      cancelAnimationFrame(enterFrame);
      cancelAnimationFrame(shownFrame);
      window.clearTimeout(exitTimer);
    };
  }, [open]);

  const { style, side } = useAnchoredPopover({
    open: open && mounted,
    anchor: triggerRef,
    panel: panelRef,
    onClose: () => setOpen(false),
    gap: 4,
    matchAnchorWidth: true,
    maxHeight: 320,
  });

  const hasSelection = value.length > 0;
  const summary = hasSelection ? selectedSummary(value, options) : placeholder;
  const host = overlayHost ?? fallbackHost;

  return (
    <div className={`redux-multi-select ${className}`}>
      <Button
        ref={triggerRef}
        id={controlId}
        type="button"
        variant="plain"
        className="redux-multi-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="redux-multi-select-summary" data-empty={!hasSelection || undefined}>
          {summary}
        </span>
        <span className="redux-multi-select-chevron" aria-hidden="true" />
      </Button>
      {mounted && host
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              className="redux-control-popup redux-multi-select-options"
              data-state={shown ? "open" : "closing"}
              data-placement={side}
              role="listbox"
              aria-multiselectable="true"
              aria-hidden={!shown}
              style={
                {
                  ...style,
                  visibility: mounted ? "visible" : "hidden",
                  "--control-origin-x": style["--popover-origin-x"],
                  "--control-origin-y": style["--popover-origin-y"],
                } as CSSProperties
              }
            >
              {options.map((option) => {
                const checked = selected.has(option.value);
                const optionDisabled = disabled || option.disabled === true;
                return (
                  <label
                    key={option.value}
                    className="redux-select-option redux-multi-select-option"
                    role="option"
                    aria-selected={checked}
                    aria-disabled={optionDisabled || undefined}
                  >
                    <span className="redux-multi-select-option-label">{option.label}</span>
                    <Input
                      type="checkbox"
                      checked={checked}
                      disabled={optionDisabled}
                      aria-label={typeof option.label === "string" ? option.label : undefined}
                      onChange={() => {
                        const next = checked
                          ? value.filter((selectedValue) => selectedValue !== option.value)
                          : [...value, option.value];
                        onChange(next);
                      }}
                    />
                  </label>
                );
              })}
            </div>,
            host,
          )
        : null}
    </div>
  );
}
