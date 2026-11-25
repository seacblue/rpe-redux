/**
 * A beat as the three parts the chart stores: whole, numerator, denominator.
 *
 * The `:` and `/` between the boxes are fixed separators, and each box normally
 * holds one part. Any box also accepts the whole beat as a shorthand
 * (`3:1/2`, `3,1,2`, or `3 1 2`); a complete triple splits across all three
 * boxes when the box is left, and the whole control commits as one value.
 *
 * The chart's beat rules are injected through `rules`, so this primitive knows
 * only three strings and never imports a product domain type
 * (`docs/architecture.md`). `partsOf` reads a stored beat, `reduce` returns the
 * beat three boxes describe (or `null`), and `parseShorthand` recognizes a whole
 * beat typed into one box.
 *
 * Leaving the whole control commits, so moving between boxes only edits a draft.
 * A caller may preserve the entered parts for that boundary commit and reduce
 * them later through its scoped close lifecycle. Escape restores the stored beat.
 * A part that is not a number, a denominator that is not positive, or a beat the
 * owner refuses leaves the value untouched: the boxes keep what was typed and
 * turn invalid, with no clamping.
 */
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Input } from "./Input.tsx";
import { registerBeatFieldScopeCommit, remainsWithinBeatField } from "./beatFieldFocus.ts";
import { useTranslation } from "../../../i18n/react.ts";
import type { BeatParts, BeatRules } from "./beatFieldRules.ts";

export { commitBeatFieldScope } from "./beatFieldFocus.ts";
export { flushBeatFieldScope } from "./beatFieldFocus.ts";

export interface BeatFieldProps {
  /** Optional id for the first input, so a FieldRow label can target the control. */
  id?: string;
  /** The committed beat, read from the owner. */
  value: readonly number[];
  /** The chart's beat rules: how the boxes read and write a beat. */
  rules: BeatRules;
  /** Apply a beat. Return `false` when the owner refused it and the value is unchanged. */
  onCommit(beat: readonly number[]): boolean | void;
  /** Exact move by one grid division; the owner owns the division. */
  onNudge?(beat: readonly number[], direction: number): readonly number[];
  /** Extra rule the owner applies before a beat may land (a Hold's end precedes its start). */
  accepts?(beat: readonly number[]): boolean;
  /** Focus is entering or leaving the whole control, not one box of it. */
  onFocusChange?(focused: boolean): void;
  /** Enter committed the tuple; a dialog uses this to accept the value in place. */
  onEnter?(): void;
  /** Compare two committed values; the default compares their parts position by position. */
  same?(left: readonly number[], right: readonly number[]): boolean;
  /** Commit when the whole composed control loses focus. */
  commitOnBlur?: boolean;
  /** Commit on Enter; deferred inspector fields turn this off to keep a local draft. */
  commitOnEnter?: boolean;
  /** Keep valid integer parts unreduced for the boundary commit. */
  preservePartsOnBlur?: boolean;
  /** Inspector scope whose close lifecycle flushes this field, when set. */
  commitScope?: string;
  disabled?: boolean;
  className?: string;
  /** The owning field's name, for the DOM contract. */
  dataField?: string;
  autoFocus?: boolean;
}

/**
 * The stored beat a complete shorthand reduces to, or the shorthand itself when
 * it is not a beat.
 */
function reducedParts(parts: BeatParts, rules: BeatRules): BeatParts {
  const beat = rules.reduce(parts);
  return beat ? rules.partsOf(beat) : parts;
}

/** The parts a box's text describes: a whole beat typed into one box, or null. */
function shorthandIn(parts: BeatParts, rules: BeatRules): BeatParts | null {
  if (!rules.parseShorthand) {
    return null;
  }
  for (const text of parts) {
    const shorthand = rules.parseShorthand(text);
    if (shorthand) {
      return shorthand;
    }
  }
  return null;
}

/** Whether two beats have the same three parts. */
function sameParts(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

/** Edits one committed beat through three exact part inputs. */
export function BeatField({
  id,
  value,
  rules,
  onCommit,
  onNudge,
  accepts,
  onFocusChange,
  onEnter,
  same = sameParts,
  commitOnBlur = true,
  commitOnEnter = true,
  preservePartsOnBlur = false,
  commitScope,
  disabled = false,
  className = "",
  dataField,
  autoFocus = false,
}: BeatFieldProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLSpanElement>(null);
  const [draft, setDraft] = useState<BeatParts>(() => rules.partsOf(value));
  const draftRef = useRef<BeatParts>(draft);
  const valueRef = useRef(value);
  const [invalid, setInvalid] = useState(false);
  const lastValue = useRef(value);
  const pendingBlur = useRef<number | null>(null);
  const scopedCommit = useRef<() => void>(() => {});
  const scopeClosed = useRef(false);

  /** Writes the draft through both the ref and React state. */
  const setDraftParts = (next: BeatParts): void => {
    draftRef.current = next;
    setDraft(next);
  };

  // The owner is the truth: whenever the beat changes under us (a nudge from the
  // buttons, an undo, another line's note) the boxes follow it. A rejected draft
  // that never reached the owner changes no beat, so it stays as typed. The rules
  // and the comparison come from the caller and are stable for one field.
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (same(value, lastValue.current)) {
      return;
    }
    lastValue.current = value;
    setDraftParts(rules.partsOf(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /**
   * Hand a beat to the owner. `false` (or a throw — a focus handler must not
   * crash the panel) means the owner kept its old value.
   */
  const offer = (beat: readonly number[]): boolean => {
    try {
      return onCommit(beat) !== false;
    } catch {
      return false;
    }
  };

  /** The one place a beat is written: complete, acceptable, and never clamped. */
  const commit = (raw: BeatParts, reduce = true): boolean => {
    // A complete beat typed into one box replaces all three parts here, so the
    // boxes show the stored parts once the control is left or Enter runs.
    const shorthand = shorthandIn(raw, rules);
    const parts = shorthand ? shorthand : raw;
    const beat = reduce ? rules.reduce(parts) : (rules.preserve?.(parts) ?? rules.reduce(parts));
    if (!beat) {
      if (parts !== raw) {
        setDraftParts(parts);
      }
      setInvalid(true);
      return false;
    }
    // A boundary commit may preserve an unreduced integer triple until the
    // inspector closes; otherwise show the canonical parts immediately.
    setDraftParts(reduce ? rules.partsOf(beat) : parts);
    if (accepts && !accepts(beat)) {
      setInvalid(true);
      return false;
    }
    setInvalid(false);
    if (same(beat, valueRef.current)) {
      return true;
    }
    const accepted = offer(beat);
    if (accepted) {
      valueRef.current = beat;
    }
    setInvalid(!accepted);
    return accepted;
  };

  useEffect(() => {
    scopedCommit.current = () => {
      scopeClosed.current = true;
      // A pane can close before the deferred root blur runs. The close flush has
      // already reduced and stored the draft, so the old blur must not write its
      // preserved parts back over that canonical value.
      if (pendingBlur.current !== null) {
        window.clearTimeout(pendingBlur.current);
        pendingBlur.current = null;
      }
      commit(draftRef.current, true);
    };
    if (disabled) {
      scopedCommit.current = () => undefined;
    }
  });

  useEffect(() => {
    if (!commitScope) {
      return undefined;
    }
    return registerBeatFieldScopeCommit(commitScope, () => scopedCommit.current());
  }, [commitScope]);

  const nudge = (direction: number) => {
    if (!onNudge || disabled) {
      return;
    }
    const base = rules.reduce(draft) ?? value;
    const moved = onNudge(base, direction);
    // A refused move leaves the beat where the owner still has it.
    const accepted = offer(moved);
    setInvalid(!accepted);
    setDraftParts(rules.partsOf(accepted ? moved : value));
  };
  const nudgeRef = useRef(nudge);
  const nudgeEnabled = useRef(!disabled && Boolean(onNudge));
  useEffect(() => {
    nudgeRef.current = nudge;
    nudgeEnabled.current = !disabled && Boolean(onNudge);
  });

  /**
   * Typing only updates the draft. A whole beat typed into one box stays as
   * typed until the control commits, so the boxes change when the author leaves
   * them — not while the cursor is still in the box.
   */
  const edit = (index: 0 | 1 | 2, text: string) => {
    const next = [...draftRef.current] as BeatParts;
    next[index] = text;
    setDraftParts(next);
    setInvalid(false);
  };

  /**
   * Leaving a box is when a whole beat typed into it is split across the three
   * boxes; a partial edit stays exactly as typed until the control commits.
   */
  const syncPart = (index: 0 | 1 | 2, event: FocusEvent<HTMLInputElement>) => {
    if (scopeClosed.current) {
      return;
    }
    const next = [...draftRef.current] as BeatParts;
    next[index] = event.currentTarget.value;
    if (preservePartsOnBlur) {
      setDraftParts(next);
      return;
    }
    const shorthand = shorthandIn(next, rules);
    setDraftParts(shorthand ? reducedParts(shorthand, rules) : next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (commitOnEnter) {
        // Enter commits the tuple in place; the field keeps focus so a value can
        // be corrected without clicking back into it.
        commit(draftRef.current);
        onEnter?.();
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraftParts(rules.partsOf(value));
      setInvalid(false);
    }
  };

  // Focus is one control made of three boxes: moving between them is not leaving
  // it, so only a blur that lands outside signals the owner. Defer the decision
  // until the browser has moved focus: some WebViews omit `relatedTarget` even
  // when the next part input is the one receiving focus.
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (scopeClosed.current) {
      return;
    }
    if (!commitOnBlur) {
      return;
    }
    const next = event.relatedTarget;
    if (next instanceof Node && root.current?.contains(next)) {
      return;
    }
    const previous = event.target;
    if (pendingBlur.current !== null) {
      window.clearTimeout(pendingBlur.current);
    }
    pendingBlur.current = window.setTimeout(() => {
      pendingBlur.current = null;
      if (remainsWithinBeatField(root.current, next, previous, document.activeElement)) {
        return;
      }
      commit(draftRef.current, !preservePartsOnBlur);
      onFocusChange?.(false);
    }, 0);
  };

  /** Drops a deferred boundary check when the field leaves the tree. */
  useEffect(
    () => () => {
      if (pendingBlur.current !== null) {
        window.clearTimeout(pendingBlur.current);
        pendingBlur.current = null;
      }
    },
    [],
  );

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
      // Each box holds one value of the beat, so a click replaces it exactly as
      // it would in a numeric field.
      holdsValue
      // The three boxes read as one composed beat, so each part stays centred.
      textAlign="center"
      spellCheck={false}
      autoComplete="off"
      autoFocus={index === 0 && autoFocus}
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
        scopeClosed.current = false;
        if (pendingBlur.current !== null) {
          window.clearTimeout(pendingBlur.current);
          pendingBlur.current = null;
        }
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
