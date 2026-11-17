/**
 * Keyboard hints: one key cap, a row of them, and the shortcut model's own view
 * of both.
 *
 * `Kbd` draws a stroke, `KbdParts` draws the same parts inside a caller-owned
 * shell (the editable shortcut chip), `KbdBindings` draws the bindings of one
 * shortcut, and `ShortcutBindings` takes the model itself. Only the last of them
 * knows `core`'s `Shortcut`; `shortcutChips.ts` beside this file turns a value
 * into strokes, so the rest of `core` never learns what a chip looks like.
 */
import type { HTMLAttributes } from "react";
import type { Shortcut } from "../../../core/shortcuts/types.ts";
import { shortcutChips } from "./shortcutChips.ts";

/** One drawn key: readable text, or a fixed inline image plus its accessible name. */
export interface KbdKeyCap {
  label: string;
  /** Data URL for a mouse or wheel key; omitted for text key caps. */
  icon?: string;
}

export interface KbdStroke {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  /** The non-modifier keys, in display order. */
  keys: readonly KbdKeyCap[];
}

export interface KbdProps extends Omit<HTMLAttributes<HTMLElement>, "children">, KbdStroke {}

/** Every cap of a stroke in written order: modifiers, then the chord keys. */
function strokeParts({
  ctrl = false,
  alt = false,
  shift = false,
  meta = false,
  keys,
}: KbdStroke): KbdKeyCap[] {
  return [
    ...(ctrl ? [{ label: "Ctrl" }] : []),
    ...(alt ? [{ label: "Alt" }] : []),
    ...(shift ? [{ label: "Shift" }] : []),
    ...(meta ? [{ label: "Meta" }] : []),
    ...keys,
  ];
}

/** The caps of one stroke without the `<kbd>` shell. */
export function KbdParts({ stroke }: { stroke: KbdStroke }) {
  const parts = strokeParts(stroke);
  return (
    <span className="redux-kbd-parts">
      {parts.map((part, index) => (
        <span className="redux-kbd-part" key={`${part.label}:${index}`}>
          {index > 0 && (
            <span className="redux-kbd-plus" aria-hidden="true">
              +
            </span>
          )}
          {part.icon ? (
            <img
              className="redux-kbd-key-icon"
              src={part.icon}
              alt={part.label}
              draggable={false}
              width={16}
              height={16}
            />
          ) : (
            part.label
          )}
        </span>
      ))}
    </span>
  );
}

/** One chord drawn as key caps in written order. */
export function Kbd({
  className = "",
  ctrl = false,
  alt = false,
  shift = false,
  meta = false,
  keys,
  ...props
}: KbdProps) {
  if (!strokeParts({ ctrl, alt, shift, meta, keys }).length) {
    return null;
  }
  return (
    <kbd className={`redux-kbd ${className}`.trim()} {...props}>
      <KbdParts stroke={{ ctrl, alt, shift, meta, keys }} />
    </kbd>
  );
}

/** Renders each binding as a chip; distinct bindings are separated only by gap. */
export function KbdBindings({
  strokes,
  className = "",
}: {
  strokes: readonly KbdStroke[];
  className?: string;
}) {
  return (
    <span className={`redux-kbd-group ${className}`.trim()}>
      {strokes.map((stroke, index) => (
        <Kbd {...stroke} key={`${stroke.keys.map((key) => key.label).join("+")}:${index}`} />
      ))}
    </span>
  );
}

/** The same row, handed the model instead of strokes. */
export function ShortcutBindings({
  bindings,
  className = "",
}: {
  bindings: readonly Shortcut[];
  className?: string;
}) {
  return <KbdBindings strokes={shortcutChips(bindings)} className={className} />;
}
