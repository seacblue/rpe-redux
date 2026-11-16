/**
 * Edits one input stepper button's signed increment in the shared control popup.
 * The owner keeps the magnitude in its settings or field model; this panel
 * preserves the direction sign for the user and reports the positive magnitude.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/button/Button.tsx";
import { FloatingPanel } from "../components/floatingPanel/FloatingPanel.tsx";
import { Input } from "../components/input/Input.tsx";
import { useTranslation } from "../../i18n/react.ts";
import { closeControlPopup, handleControlPopupEscape } from "./controlActions.ts";
import type { StepperPopupState } from "./controlActions.ts";
import { placeControlPopup } from "./controlPopupPlacement.ts";

/** A small anchored editor for one stepper increment. */
export function StepperPopup({ state }: { state: StepperPopupState }) {
  const { t } = useTranslation();
  const [manualPosition, setManualPosition] = useState<{ left: number; top: number } | null>(null);
  const [draft, setDraft] = useState(
    state.direction === "increase" ? `+${state.value}` : `-${state.value}`,
  );
  const title =
    state.direction === "increase"
      ? t("design.numberInput.increase")
      : t("design.numberInput.decrease");

  const commit = useCallback(() => {
    const value = Math.abs(Number(draft));
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (state.min !== undefined && value < state.min) ||
      (state.max !== undefined && value > state.max)
    ) {
      return;
    }
    state.onCommit(value);
    closeControlPopup(true);
  }, [draft, state]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (handleControlPopupEscape(event)) {
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    };
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, [commit]);

  const { style } = placeControlPopup({
    anchor: state.anchor,
    panelWidth: 220,
    panelHeight: 142,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });

  return (
    <FloatingPanel
      className="redux-stepper-popup"
      style={style}
      position={manualPosition ?? undefined}
      onPositionChange={setManualPosition}
      title={title}
      aria-label={title}
      footer={
        <>
          <Button variant="outlined" size="sm" onClick={() => closeControlPopup(true)}>
            {t("common.action.cancel")}
          </Button>
          <Button variant="solid" size="sm" onClick={commit}>
            {t("common.action.apply")}
          </Button>
        </>
      }
    >
      <label>
        <span>{t("design.numberInput.stepValue")}</span>
        <Input
          autoFocus
          type="text"
          inputMode="decimal"
          step="any"
          value={draft}
          aria-label={t("design.numberInput.stepValue")}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      </label>
    </FloatingPanel>
  );
}
