/**
 * A beat as the three parts the chart stores: whole, numerator, denominator.
 *
 * The `:` and `/` between the boxes are fixed separators, not characters the
 * author has to type, so a beat is never a text that has to be parsed: each box
 * holds one part. A part may be typed as a decimal, and leaving its box folds it
 * back into the stored triple exactly — `beatParts.ts` owns that rule (a decimal
 * whole replaces the fraction, a decimal numerator goes over the denominator, a
 * decimal denominator divides the numerator).
 *
 * Leaving the whole control commits, so moving between boxes only edits a draft.
 * Escape restores the stored beat. A part that is not a number, a denominator
 * that is not positive, or a beat the owner refuses leaves the chart untouched:
 * the boxes keep what was typed and turn invalid, with no clamping.
 *
 * It sits in the inspector layer rather than `design/` because it speaks the
 * chart's own `Beat` type and reduction rule; a design primitive may not import
 * product domain code (`AGENTS.md`).
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { useTranslation } from "../../../../../i18n/react.ts";
import {
  compareBeats,
  formatBeat,
  type Beat,
} from "../../../../../core/global/chart/timing/beat.ts";
import { draftBeat, partsOf, type Parts } from "./beatParts.ts";

export interface BeatFieldProps {
  /** Optional id for the first input, so a FieldRow label can target the control. */
  id?: string;
  /** The committed beat, read from the chart. */
  value: Beat;
  /** Apply a beat. Return `false` when the owner refused it and the chart is unchanged. */
  onCommit(beat: Beat): boolean | void;
  /** Exact move by one grid division; the owner owns the division. */
  onNudge?(beat: Beat, direction: number): Beat;
  /** Extra rule the owner applies before a beat may land (a Hold's end precedes its start). */
  accepts?(beat: Beat): boolean;
  /** Focus is entering or leaving the whole control, not one box of it. */
  onFocusChange?(focused: boolean): void;
  disabled?: boolean;
  className?: string;
  /** The owning field's name, for the DOM contract. */
  dataField?: string;
}

/** Edits one committed beat through three exact part inputs. */
export function BeatField({
  id,
  value,
  onCommit,
  onNudge,
  accepts,
  onFocusChange,
  disabled = false,
  className = "",
  dataField,
}: BeatFieldProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLSpanElement>(null);
  const stored = formatBeat(value);
  const [draft, setDraft] = useState<Parts>(() => partsOf(value));
  const draftRef = useRef<Parts>(draft);
  const [invalid, setInvalid] = useState(false);
  const lastStored = useRef(stored);

  /** Writes the draft through both the ref and React state. */
  const setDraftParts = (next: Parts): void => {
    draftRef.current = next;
    setDraft(next);
  };

  // The chart is the truth: whenever the beat changes under us (a nudge from the
  // buttons, an undo, another line's note) the boxes follow it. A rejected draft
  // that never reached the chart changes no beat, so it stays as typed.
  useEffect(() => {
    if (stored !== lastStored.current) {
      lastStored.current = stored;
      setDraftParts(partsOf(value));
      setInvalid(false);
    }
  }, [stored, value]);

  /**
   * Hand a beat to the owner. `false` (or a throw — a focus handler must not
   * crash the panel) means the chart kept its old value.
   */
  const offer = (beat: Beat): boolean => {
    try {
      return onCommit(beat) !== false;
    } catch {
      return false;
    }
  };

  /** The one place a beat is written: complete, acceptable, and never clamped. */
  const commit = (parts: Parts): boolean => {
    const beat = draftBeat(parts);
    if (!beat) {
      setInvalid(true);
      return false;
    }
    // Show the reduced triple the chart stores (or would store), so a decimal
    // turns into the exact parts the moment the box is left.
    setDraftParts(partsOf(beat));
    if (accepts && !accepts(beat)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    if (compareBeats(beat, value) === 0) {
      return true;
    }
    const accepted = offer(beat);
    setInvalid(!accepted);
    return accepted;
  };

  const nudge = (direction: number) => {
    if (!onNudge || disabled) {
      return;
    }
    const base = draftBeat(draft) ?? value;
    const moved = onNudge(base, direction);
    // A beat position never goes below zero, even when an owner's own nudge
    // rule does not clamp.
    const next = compareBeats(moved, [0, 0, 1]) < 0 ? ([0, 0, 1] as Beat) : moved;
    // A refused move leaves the beat where the chart still has it.
    const accepted = offer(next);
    setInvalid(!accepted);
    setDraftParts(partsOf(accepted ? next : value));
  };
  const nudgeRef = useRef(nudge);
  const nudgeEnabled = useRef(!disabled && Boolean(onNudge));
  useEffect(() => {
    nudgeRef.current = nudge;
    nudgeEnabled.current = !disabled && Boolean(onNudge);
  });

  const edit = (index: 0 | 1 | 2, text: string) => {
    const next = [...draftRef.current] as Parts;
    next[index] = text;
    setDraftParts(next);
    setInvalid(false);
  };

  /**
   * Moving between boxes only updates the draft. The outer control's blur commits
   * the complete tuple after the last box has supplied its current value.
   */
  const syncPart = (index: 0 | 1 | 2, event: FocusEvent<HTMLInputElement>) => {
    const next = [...draftRef.current] as Parts;
    next[index] = event.currentTarget.value;
    setDraftParts(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraftParts(partsOf(value));
      setInvalid(false);
    }
  };

  // Focus is one control made of three boxes: moving between them is not leaving
  // it, so only a blur that lands outside signals the owner.
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && root.current?.contains(next)) {
      return;
    }
    commit(draftRef.current);
    onFocusChange?.(false);
  };

  // The whole composed control is a wheel target: the boxes, their padding, the
  // separators, and the grid gaps between them. A native non-passive listener
  // stops the inspector from scrolling while the beat steps, which React's
  // delegated wheel handler cannot do.
  useEffect(() => {
    const field = root.current;
    if (!field) {
      return;
    }
    const wheel = (event: WheelEvent) => {
      if (!nudgeEnabled.current || !event.deltaY || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      nudgeRef.current(-Math.sign(event.deltaY));
    };
    field.addEventListener("wheel", wheel, { passive: false });
    return () => field.removeEventListener("wheel", wheel);
  }, []);

  /** Renders one of the three part inputs. */
  const part = (index: 0 | 1 | 2, label: string, extraClass: string) => (
    <Input
      id={index === 0 ? id : undefined}
      className={`beat-field-part ${extraClass}`}
      type="text"
      inputMode="decimal"
      // The three boxes read as one composed beat, so each part stays centred.
      textAlign="center"
      spellCheck={false}
      autoComplete="off"
      value={draft[index]}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      data-beat-part={index}
      onChange={(event) => edit(index, event.currentTarget.value)}
      onBlur={(event) => syncPart(index, event)}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <span
      ref={root}
      className={`beat-field${className ? ` ${className}` : ""}`}
      data-beat="true"
      data-inspector-field={dataField}
      onFocus={() => {
        onFocusChange?.(true);
      }}
      onBlur={onBlur}
    >
      {part(0, t("design.beat.whole"), "beat-field-whole")}
      <span className="beat-field-separator" aria-hidden="true">
        :
      </span>
      {part(1, t("design.beat.numerator"), "beat-field-numerator")}
      <span className="beat-field-separator" aria-hidden="true">
        /
      </span>
      {part(2, t("design.beat.denominator"), "beat-field-denominator")}
    </span>
  );
}
