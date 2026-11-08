/**
 * Design-system dropdown rendered for a native `<select>`: reads options at open
 * time, mirrors disabled and selected rows, and writes the choice back to the
 * element, which remains the value holder.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n/react.ts";
import { closeControlPopup, handleControlPopupEscape, popupDialogBoxOf } from "./controlActions.ts";
import type { SelectPopupState } from "./controlActions.ts";
import { placeControlPopup } from "./controlPopupPlacement.ts";

/** One option as the popup renders it. */
interface OptionEntry {
  index: number;
  value: string;
  label: string;
  group: string;
  disabled: boolean;
}

/** Read the current options of a native select at open time. */
function optionsOf(select: HTMLSelectElement): OptionEntry[] {
  return [...select.options].map((option, index) => {
    const parent = option.parentElement;
    return {
      index,
      value: option.value,
      label: option.textContent ?? option.value,
      group: parent?.tagName === "OPTGROUP" ? (parent as HTMLOptGroupElement).label : "",
      disabled: option.disabled,
    };
  });
}

/**
 * Write a native select's choice and announce it in the order a real pick
 * produces: `input` for bound React controls, then `change` for panel listeners.
 */
function commitSelection(element: HTMLSelectElement, index: number) {
  element.selectedIndex = index;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The dropdown panel a native `select` opens in place of the OS list.
 *
 * The element stays in the document and keeps its value; this panel reads its
 * `<option>` children at open time, so options added after mount are visible.
 * Choosing writes the element's selection and closes the popup.
 */
export function SelectPopup({ state }: { state: SelectPopupState }) {
  const { t } = useTranslation();
  const { element, anchor } = state;
  const options = optionsOf(element);
  const [active, setActive] = useState(() => Math.max(0, element.selectedIndex));

  /** Commit one option index and close the popup with focus restored. */
  const choose = useCallback(
    (index: number) => {
      const option = element.options[index];
      if (!option || option.disabled) {
        return;
      }
      commitSelection(element, index);
      closeControlPopup(true);
    },
    [element],
  );

  useEffect(() => {
    /** Move the highlighted row by `step`, skipping disabled options. */
    const move = (step: number) => {
      setActive((current) => {
        let next = current;
        for (let guard = 0; guard < options.length; guard += 1) {
          next = (next + step + options.length) % options.length;
          if (!options[next]?.disabled) {
            break;
          }
        }
        return next;
      });
    };
    const keys = (event: KeyboardEvent) => {
      if (handleControlPopupEscape(event)) {
        return;
      }
      switch (event.key) {
        case "Enter":
        case " ":
          event.preventDefault();
          setActive((current) => {
            choose(current);
            return current;
          });
          return;
        case "ArrowDown":
          event.preventDefault();
          move(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          return;
        case "Home":
          event.preventDefault();
          setActive(0);
          return;
        case "End":
          event.preventDefault();
          setActive(Math.max(0, options.length - 1));
          return;
        default:
          break;
      }
      // Type-ahead, like the native list: a printable key jumps to the next
      // option starting with it.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const needle = event.key.toLocaleLowerCase();
        const start = options.findIndex(
          (option, index) => index > active && option.label.toLocaleLowerCase().startsWith(needle),
        );
        const fallback = options.findIndex((option) =>
          option.label.toLocaleLowerCase().startsWith(needle),
        );
        const found = start >= 0 ? start : fallback;
        if (found >= 0) {
          event.preventDefault();
          setActive(found);
        }
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, [active, choose, options]);

  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const dialogBox = popupDialogBoxOf(element);
  const width = Math.min(
    Math.max(anchor.width, 1),
    Math.max(1, viewport.width - 12),
    Math.max(1, (dialogBox?.width ?? viewport.width) - 12),
  );
  const groupCount = options.filter(
    (option, index) => option.group && option.group !== options[index - 1]?.group,
  ).length;
  const naturalHeight = Math.min(options.length * 36 + groupCount * 28 + 2, 320);
  const { style } = placeControlPopup({
    anchor,
    panelWidth: width,
    panelHeight: naturalHeight,
    dialog: dialogBox,
    viewport,
    clampHeight: true,
    flipThreshold: Math.min(naturalHeight, 120),
    preferLargerSide: true,
    placement: "below",
  });

  return (
    <div className="redux-control-popup redux-select-popup" role="listbox" style={style}>
      {options.length === 0 && <div className="redux-select-empty">{t("design.select.empty")}</div>}
      {options.map((option, index) => (
        <div key={`${option.index}:${option.value}`}>
          {option.group && option.group !== options[index - 1]?.group && (
            <div className="redux-select-group" role="presentation">
              {option.group}
            </div>
          )}
          <div
            className="redux-select-option"
            role="option"
            aria-selected={option.index === element.selectedIndex}
            aria-disabled={option.disabled || undefined}
            data-active={option.index === active}
            onPointerEnter={() => setActive(option.index)}
            onClick={() => choose(option.index)}
          >
            {option.label}
          </div>
        </div>
      ))}
    </div>
  );
}
