/**
 * Design-system colour picker popup: saturation/brightness square, hue strip, and
 * hex/channel fields. It writes through the native color input so existing
 * listeners keep working; `controlActions` owns the popup stack.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/button/Button.tsx";
import { Input } from "../components/input/Input.tsx";
import { useTranslation } from "../../i18n/react.ts";
import { closeControlPopup, handleControlPopupEscape, popupDialogBoxOf } from "./controlActions.ts";
import { writeInputValue } from "./nativeValue.ts";
import type { ColorPopupState } from "./controlActions.ts";
import { clamp01 } from "../../core/utils/numbers.ts";
import { placeControlPopup } from "./controlPopupPlacement.ts";
import {
  cssColor,
  displayHexColor,
  formatHexColor,
  normalizeHexColor,
  parseHexColor,
} from "../components/input/colorModel.ts";
import type { CSSProperties } from "react";

/** Hue, saturation, and value, each normalized to 0..1. */
interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Convert normalized HSV to normalized RGB. */
function hsvToRgb({ h, s, v }: Hsv): { r: number; g: number; b: number } {
  const sector = ((h % 1) + 1) % 1;
  const index = Math.floor(sector * 6);
  const fraction = sector * 6 - index;
  const p = v * (1 - s);
  const q = v * (1 - fraction * s);
  const t = v * (1 - (1 - fraction) * s);
  const table: [number, number, number][] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  const [r, g, b] = table[index % 6];
  return { r, g, b };
}

/** Convert normalized RGB to normalized HSV. */
function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 1e-6) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h = (h / 6 + 1) % 1;
  }
  return { h, s: max <= 0 ? 0 : delta / max, v: max };
}

/** Parse hexadecimal text into normalized RGB, or `null` when it is malformed. */
function parseHex(
  text: string,
): { r: number; g: number; b: number; alpha: number; hasAlpha: boolean } | null {
  const parsed = parseHexColor(text);
  if (!parsed) {
    return null;
  }
  return {
    r: parsed.red / 255,
    g: parsed.green / 255,
    b: parsed.blue / 255,
    alpha: parsed.alpha,
    hasAlpha: parsed.hasAlpha,
  };
}

/** Format normalized RGB as a lowercase `#rrggbb` string. */
function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const byte = (channel: number) =>
    Math.round(clamp01(channel) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();
}

/** Write a colour onto the native color input and announce the change. */
function commitColor(element: HTMLInputElement, value: string, alpha: number, allowAlpha: boolean) {
  writeInputValue(element, normalizeHexColor(value));
  if (allowAlpha) {
    element.dataset.colorAlpha = String(clamp01(alpha));
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The picker an `input[type=color]` opens in place of the OS dialog.
 *
 * A saturation/brightness square, a hue strip, a hex field, and three channel
 * fields. The native element remains the value holder: applying writes `value`
 * and dispatches `input`/`change`, exactly as the OS dialog does, so existing
 * listeners need no knowledge of this panel.
 */
export function ColorPopup({ state }: { state: ColorPopupState }) {
  const { t } = useTranslation();
  const { element, anchor } = state;
  const allowAlpha = element.dataset.colorAlphaEnabled === "true";
  const original = element.value;
  const initial = parseHex(original) ?? { r: 0, g: 0, b: 0, alpha: 1, hasAlpha: false };
  const [hsv, setHsv] = useState<Hsv>(() => {
    return rgbToHsv(initial.r, initial.g, initial.b);
  });
  const [alpha, setAlpha] = useState(() => {
    const stored = Number(element.dataset.colorAlpha);
    return allowAlpha && Number.isFinite(stored) ? clamp01(stored) : allowAlpha ? initial.alpha : 1;
  });
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const square = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);

  const rgb = hsvToRgb(hsv);
  const color = toHex(rgb);
  const shownHex = hexDraft ?? color;
  const storedColor = formatHexColor(color, alpha);
  const shownColor = displayHexColor(storedColor, allowAlpha);
  const fillStyle = { "--redux-color-fill": cssColor(storedColor) } as CSSProperties;
  const channels = {
    r: Math.round(rgb.r * 255),
    g: Math.round(rgb.g * 255),
    b: Math.round(rgb.b * 255),
  };

  /** One place that changes the color, so hex and channels cannot drift apart. */
  const setFromRgb = useCallback((next: { r: number; g: number; b: number }) => {
    setHexDraft(null);
    setHsv(rgbToHsv(next.r, next.g, next.b));
  }, []);

  /** A drag or a key changes the color directly; a pending hex draft is cleared. */
  const setHsvFromUser = useCallback((updater: (current: Hsv) => Hsv) => {
    setHexDraft(null);
    setHsv(updater);
  }, []);

  const apply = useCallback(
    (value: string) => {
      commitColor(element, value, alpha, allowAlpha);
      closeControlPopup(true);
    },
    [allowAlpha, alpha, element],
  );

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      handleControlPopupEscape(event);
    };
    document.addEventListener("keydown", keys, true);
    return () => document.removeEventListener("keydown", keys, true);
  }, []);

  /** Map a pointer position onto the 0..1 box of one drag surface. */
  const drag = (
    event: React.PointerEvent<HTMLDivElement>,
    target: HTMLDivElement | null,
    update: (x: number, y: number) => void,
  ) => {
    if (!target) {
      return;
    }
    const box = target.getBoundingClientRect();
    update(
      clamp01((event.clientX - box.left) / Math.max(1, box.width)),
      clamp01((event.clientY - box.top) / Math.max(1, box.height)),
    );
  };

  const width = 392;
  const height = allowAlpha ? 370 : 312;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const dialogBox = popupDialogBoxOf(element);
  const { style } = placeControlPopup({
    anchor,
    panelWidth: width,
    panelHeight: height,
    dialog: dialogBox,
    viewport,
    flipAboveInset: 0,
  });

  const squareBackground = toHex(hsvToRgb({ h: hsv.h, s: 1, v: 1 }));

  return (
    <div className="redux-control-popup redux-color-popup" style={style}>
      <div className="redux-color-head">
        <span>{t("design.colorPicker.title")}</span>
        <span className="redux-color-current-hex">
          <span
            className={`redux-color-current-swatch${allowAlpha ? " redux-color-checker" : ""}`}
            style={allowAlpha ? fillStyle : { background: color }}
          />
          {shownColor}
        </span>
      </div>
      <div className="redux-color-body">
        <div
          ref={square}
          className="redux-color-square"
          style={{ background: squareBackground }}
          role="slider"
          tabIndex={0}
          aria-label={t("design.colorPicker.squareLabel")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.s * 100)}
          aria-valuetext={t("design.colorPicker.squareValue", {
            saturation: Math.round(hsv.s * 100),
            brightness: Math.round(hsv.v * 100),
          })}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag(event, square.current, (x, y) =>
              setHsvFromUser((current) => ({ ...current, s: x, v: 1 - y })),
            );
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              drag(event, square.current, (x, y) =>
                setHsvFromUser((current) => ({ ...current, s: x, v: 1 - y })),
              );
            }
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.05 : 0.01;
            const deltas: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, step],
              ArrowDown: [0, -step],
            };
            const delta = deltas[event.key];
            if (!delta) {
              return;
            }
            event.preventDefault();
            setHsvFromUser((current) => ({
              ...current,
              s: clamp01(current.s + delta[0]),
              v: clamp01(current.v + delta[1]),
            }));
          }}
        >
          <span className="redux-color-square-white" />
          <span className="redux-color-square-black" />
          <span
            className="redux-color-marker"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
          />
        </div>
        <div
          ref={strip}
          className="redux-color-hue"
          role="slider"
          tabIndex={0}
          aria-label={t("design.colorPicker.hueLabel")}
          aria-valuenow={Math.round(hsv.h * 360)}
          aria-valuemin={0}
          aria-valuemax={360}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            drag(event, strip.current, (unused, y) =>
              setHsvFromUser((current) => ({ ...current, h: y })),
            );
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              drag(event, strip.current, (unused, y) =>
                setHsvFromUser((current) => ({ ...current, h: y })),
              );
            }
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.05 : 0.01;
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
              return;
            }
            event.preventDefault();
            setHsvFromUser((current) => ({
              ...current,
              h: (((current.h + (event.key === "ArrowUp" ? -step : step)) % 1) + 1) % 1,
            }));
          }}
        >
          <span className="redux-color-hue-marker" style={{ top: `${hsv.h * 100}%` }} />
        </div>
      </div>
      <div className="redux-color-fields">
        <label>
          <span>{t("design.colorPicker.hexLabel")}</span>
          <Input
            type="text"
            className="redux-input"
            spellCheck={false}
            value={shownHex}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setHexDraft(text);
              const parsed = parseHex(text);
              if (parsed) {
                // Keep the typed text visible while the parsed colour paints the
                // square; clearing the draft here would rewrite the caret.
                setHsv(rgbToHsv(parsed.r, parsed.g, parsed.b));
                if (allowAlpha && parsed.hasAlpha) {
                  setAlpha(parsed.alpha);
                }
              }
            }}
            onBlur={() => setHexDraft(null)}
          />
        </label>
        {(["r", "g", "b"] as const).map((channel) => (
          <label key={channel}>
            <span>{channel.toUpperCase()}</span>
            <Input
              type="number"
              textAlign="center"
              min={0}
              max={255}
              value={channels[channel]}
              onChange={(event) => {
                const next = { ...channels, [channel]: Number(event.target.value) };
                setFromRgb({ r: next.r / 255, g: next.g / 255, b: next.b / 255 });
              }}
            />
          </label>
        ))}
        {allowAlpha && (
          <label className="redux-color-alpha-channel">
            <span>A</span>
            <Input
              type="number"
              textAlign="center"
              min={0}
              max={100}
              value={Math.round(alpha * 100)}
              aria-label={t("design.colorPicker.alphaValue")}
              onChange={(event) => setAlpha(clamp01(Number(event.currentTarget.value) / 100))}
            />
          </label>
        )}
      </div>
      <div className="redux-color-actions">
        <Button variant="outlined" onClick={() => closeControlPopup(true)}>
          {t("common.action.cancel")}
        </Button>
        <Button variant="solid" onClick={() => apply(color)}>
          {t("common.action.apply")}
        </Button>
      </div>
    </div>
  );
}
