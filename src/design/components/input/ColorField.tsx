/**
 * Colour swatch input with a readable hex readout.
 *
 * Settings rows, collaboration profiles, and any future colour field share the
 * same square swatch and WCAG-contrast ink decision; callers supply the label
 * and write the value back.
 */
import { Input } from "./Input.tsx";
import {
  colorInk,
  cssColor,
  displayHexColor,
  formatHexColor,
  normalizeColor,
  parseHexColor,
} from "./colorModel.ts";
import type { CSSProperties } from "react";

export interface ColorFieldProps {
  id?: string;
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
  describedBy?: string;
  /** Tooltip content for the swatch input. */
  tipDescription?: string;
  /** Allow the custom picker to edit and persist an alpha channel. */
  allowAlpha?: boolean;
  className?: string;
}

/** Renders a colour swatch plus its hex readout in the higher-contrast ink. */
export function ColorField({
  id,
  value,
  disabled,
  onChange,
  describedBy,
  tipDescription,
  allowAlpha = false,
  className = "",
}: ColorFieldProps) {
  const color = normalizeColor(value);
  const parsed = parseHexColor(value);
  const alpha = parsed?.alpha ?? 1;
  const display = displayHexColor(value, allowAlpha);
  const fillStyle = { "--redux-color-fill": cssColor(value) } as CSSProperties;
  return (
    <span className={`redux-color-field${className ? ` ${className}` : ""}`}>
      <span className="redux-color-swatch">
        <Input
          id={id}
          type="color"
          value={color}
          data-color-alpha-enabled={allowAlpha ? "true" : undefined}
          data-color-alpha={allowAlpha ? String(alpha) : undefined}
          disabled={disabled}
          aria-describedby={describedBy}
          tipDescription={tipDescription}
          onChange={(event) => {
            const nextAlpha = allowAlpha
              ? Number(event.currentTarget.dataset.colorAlpha ?? alpha)
              : 1;
            onChange(formatHexColor(event.currentTarget.value, nextAlpha));
          }}
        />
        <output
          className={`redux-color-hex${allowAlpha ? " redux-color-checker" : ""}`}
          data-ink={colorInk(color)}
          style={allowAlpha ? fillStyle : undefined}
        >
          {display}
        </output>
      </span>
    </span>
  );
}
