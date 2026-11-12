/**
 * The two fields the toolbar rows are built from, and the one place an entry
 * becomes a box.
 *
 * A row is a list of contributions, and the ones that carry a value — the line
 * picker, the subdivision, the grid count, the preview ratio, the playback rate —
 * differ only in their bounds and in which value they show. Keeping the shape
 * here means a row reads as a list of entries rather than a list of components
 * that each duplicate the same markup.
 *
 * Nothing here subscribes: the toolbar listens to the value registry once for
 * the whole bar and hands each field the text it shows, which is what makes a
 * field a rendering of a value rather than an owner of one.
 */
import { useRef, useState, type ReactNode, type Ref } from "react";
import { Icon, iconName } from "../../../../design/components/icon/Icon.tsx";
import { Input, type InputTextAlign } from "../../../../design/components/input/Input.tsx";
import { Select } from "../../../../design/components/select/Select.tsx";
import { values } from "../../../../core/state/values.ts";
import type {
  ToolbarField,
  ToolbarSelectField,
} from "../../../../core/shell/registries/toolbar.ts";
import { LineSelectionPicker } from "./LineSelectionPicker.tsx";

export interface ToolbarNumberFieldProps {
  id: string;
  /** The field's accessible name. */
  label: string;
  /** What the box shows; the caller keeps it in step with the value registry. */
  value: string;
  min?: number;
  max?: number;
  step?: number | "any";
  /** A ring rather than a line: past `max` comes `min`, and the reverse. */
  wrap?: boolean;
  /** Adds the field's own step buttons (`Input`'s `redux-stepper`). */
  stepper?: boolean;
  disabled?: boolean;
  /**
   * Renders a text box that carries numeric text; the caller owns the grammar
   * (the line picker's ranges and unions).
   */
  text?: boolean;
  /**
   * Inner text alignment. Omitted, the design field's trailing-edge default
   * applies; a compact cell that reads as a value names its own edge.
   */
  textAlign?: InputTextAlign;
  /**
   * The glyph the field is labelled with. A field without one is the bare box the
   * row already sizes — that is how the line picker sits in its row.
   */
  icon?: string;
  /** The class that glyph's cluster carries; `toolbarGrid.less` sizes its cells. */
  fieldClassName?: string;
  /** Attach the native field to the owning toolbar composite. */
  inputRef?: Ref<HTMLInputElement>;
  /** The shell's richer tooltip, drawn by the icon beside the field. */
  tipTitle?: string;
  tipDesc?: string;
  /**
   * Whether the box may take the text as it is being typed.
   *
   * Left out, every keystroke reaches `onInput` and the owner decides what the
   * text means. A field that declares this never has its text rewritten: a
   * refused value stays in the box, the box marks itself `aria-invalid`, and the
   * owner's value is untouched until an acceptable value arrives.
   */
  accept?(value: string): boolean;
  /**
   * Keep the text in the box until the field loses focus.
   *
   * The line field defers parsing so a range can be typed as one string; every
   * keystroke would otherwise jump the timeline under the cursor. With this set,
   * `onInput` is not called for typed text and `onCommit` receives the finished
   * string on blur or Enter.
   */
  commitOnBlur?: boolean;
  /** Whether an accepted empty edit should be committed when the field blurs. */
  commitEmptyOnBlur?: boolean;
  /** Every keystroke and every step; nothing is finished yet. */
  onInput(value: string): void;
  /**
   * The value is finished: the wheel, a step button, or the blur after an edit.
   */
  onCommit?(value: string): void;
}

/** A number box with optional bounds, a stepper, and one place that commits it. */
export function ToolbarNumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  wrap = false,
  stepper = false,
  text = false,
  textAlign,
  disabled,
  icon,
  fieldClassName,
  inputRef,
  tipTitle,
  tipDesc,
  accept,
  commitOnBlur = false,
  commitEmptyOnBlur = false,
  onInput,
  onCommit,
}: ToolbarNumberFieldProps) {
  // The text a rejected edit left in the box, tied to the value it was typed
  // against. A newer value from the registry (a timeline click, a document load)
  // is the field's truth, so the stale draft simply stops counting.
  const [draft, setDraft] = useState<{ text: string; base: string } | null>(null);
  // The value the box held when the edit started, so a blur only commits a change
  // and a wheel that already committed does not commit twice.
  const settled = useRef<string | null>(null);
  const draftText = draft !== null && draft.base === value ? draft.text : null;
  const shown = draftText ?? value;
  // An empty box is an edit in progress, not a wrong value: only text the owner
  // refuses is marked, and it is marked without ever reaching the owner. A
  // deferred field deliberately does not validate while the user is typing.
  const invalid =
    !commitOnBlur && draftText !== null && draftText !== "" && accept?.(draftText) === false;
  /** Route typed text to the owner or to a local draft, per the field's mode. */
  const change = (raw: string) => {
    if (commitOnBlur) {
      setDraft({ text: raw, base: value });
      return;
    }
    if (!accept) {
      onInput(raw);
      return;
    }
    if (raw === "" || !accept(raw)) {
      setDraft({ text: raw, base: value });
      return;
    }
    setDraft(null);
    onInput(raw);
  };
  const field = (
    <Input
      id={id}
      ref={inputRef}
      className={`toolbar-field-${id}${stepper ? " redux-stepper" : ""}`}
      stepWrap={wrap}
      textAlign={textAlign}
      type={text ? "text" : "number"}
      inputMode={text ? "text" : undefined}
      min={min}
      max={max}
      step={step}
      value={shown}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(event) => change(event.currentTarget.value)}
      onNumericWheel={
        onCommit
          ? (next) => {
              settled.current = next;
              onCommit(next);
            }
          : undefined
      }
      onFocus={
        onCommit
          ? (event) => {
              settled.current = event.currentTarget.value;
            }
          : undefined
      }
      onBlur={
        onCommit || accept || commitOnBlur
          ? (event) => {
              if (commitOnBlur) {
                const next = draftText;
                if (
                  next !== null &&
                  (next.trim() !== "" || commitEmptyOnBlur) &&
                  accept?.(next) !== false
                ) {
                  onCommit?.(next);
                }
                setDraft(null);
                settled.current = null;
                return;
              }
              if (draftText !== null) {
                // The field's value never took the refused text, so the box must
                // not keep it once the cursor leaves.
                setDraft(null);
                settled.current = null;
                return;
              }
              const next = event.currentTarget.value;
              if (settled.current !== null && next !== settled.current) {
                onCommit?.(next);
              }
              settled.current = null;
            }
          : undefined
      }
      onKeyDown={
        text
          ? (event) => {
              if (commitOnBlur && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
                return;
              }
              // A text field loses the native number-input arrows. The line field
              // walks one line at a time with them, bounded by its range.
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return;
              }
              const current = Number(shown);
              if (!Number.isFinite(current)) {
                return;
              }
              event.preventDefault();
              const step = event.key === "ArrowUp" ? 1 : -1;
              const next = current + step;
              const bounded = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next));
              onInput(String(bounded));
            }
          : undefined
      }
    />
  );
  if (!icon) {
    return field;
  }
  return (
    <div className="redux-group editor-grid">
      <label className={fieldClassName}>
        <span className="toolbar-field-icon" data-tip-title={tipTitle} data-tip-desc={tipDesc}>
          <Icon name={iconName(icon)} size={16} />
        </span>
        {field}
      </label>
    </div>
  );
}

export interface ToolbarSelectProps {
  id: string;
  value: string;
  options: readonly string[];
  /** The glyph or text in front of the select — this field's own name. */
  leading?: ReactNode;
  /** The select's accessible name when the field carries a glyph rather than text. */
  label?: string;
  /** The class the label carries; the sheet sizes the cells by it. */
  className?: string;
  onChange(value: string): void;
}

/** Renders the line field and gives its picker the same native input ref. */
function ToolbarLinePickerField({
  entry,
  tRaw,
}: {
  entry: Extract<ToolbarField, { field: "number" }>;
  tRaw: (key: string) => string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="line-picker-control">
      <ToolbarNumberField
        id={entry.domId}
        inputRef={inputRef}
        value={values.byId.get<string>(entry.value)}
        label={tRaw(entry.label)}
        min={resolvedBound(entry.min)}
        max={resolvedBound(entry.max)}
        step={entry.step}
        wrap={entry.wrap}
        stepper={entry.stepper}
        text={entry.text}
        textAlign={entry.textAlign}
        disabled={entry.disabled?.()}
        icon={entry.icon}
        fieldClassName={entry.className}
        tipTitle={entry.tipTitle ? tRaw(entry.tipTitle) : undefined}
        tipDesc={entry.tipDesc ? tRaw(entry.tipDesc) : undefined}
        accept={entry.accept}
        commitOnBlur={entry.commitOnBlur}
        commitEmptyOnBlur={entry.commitEmptyOnBlur}
        onInput={(next) => entry.input(next)}
        onCommit={entry.commit ? (next) => entry.commit?.(next) : undefined}
      />
      <LineSelectionPicker inputRef={inputRef} />
    </div>
  );
}

/** A select with the field's name in front of it. */
function ToolbarSelect({
  id,
  value,
  options,
  leading,
  label,
  className,
  onChange,
}: ToolbarSelectProps) {
  return (
    <label className={className}>
      {leading}
      <Select
        id={id}
        className={`toolbar-field-${id}`}
        aria-label={label}
        textAlign="center"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {id === "rate" ? `${option}x` : option}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** One field entry as the box it names. The only place that knows both kinds. */
export function toolbarFieldNode(entry: ToolbarField, tRaw: (key: string) => string): ReactNode {
  const value = values.byId.get<string>(entry.value);
  if (entry.field === "select") {
    return (
      <ToolbarSelect
        id={entry.domId}
        value={value}
        options={entry.options(value)}
        leading={leadingNode(entry, tRaw, entry.tipTitle ? tRaw(entry.tipTitle) : undefined)}
        label={entry.tipTitle ? tRaw(entry.tipTitle) : undefined}
        className={entry.className}
        onChange={(next) => entry.commit(next)}
      />
    );
  }
  if (entry.dropdown === "linePicker") {
    return <ToolbarLinePickerField entry={entry} tRaw={tRaw} />;
  }
  const numberField = (
    <ToolbarNumberField
      id={entry.domId}
      value={value}
      label={tRaw(entry.label)}
      min={resolvedBound(entry.min)}
      max={resolvedBound(entry.max)}
      step={entry.step}
      wrap={entry.wrap}
      stepper={entry.stepper}
      text={entry.text}
      textAlign={entry.textAlign}
      disabled={entry.disabled?.()}
      icon={entry.icon}
      fieldClassName={entry.className}
      tipTitle={entry.tipTitle ? tRaw(entry.tipTitle) : undefined}
      tipDesc={entry.tipDesc ? tRaw(entry.tipDesc) : undefined}
      accept={entry.accept}
      commitOnBlur={entry.commitOnBlur}
      commitEmptyOnBlur={entry.commitEmptyOnBlur}
      onInput={(next) => entry.input(next)}
      onCommit={entry.commit ? (next) => entry.commit?.(next) : undefined}
    />
  );
  return numberField;
}

/** A bound that follows the document is a function; a fixed one is a number. */
const resolvedBound = (bound: number | (() => number) | undefined): number | undefined =>
  typeof bound === "function" ? bound() : bound;

/** The glyph or localized text in front of a select field. */
function leadingNode(
  entry: ToolbarSelectField,
  tRaw: (key: string) => string,
  tipTitle?: string,
): ReactNode {
  if (entry.leading) {
    return tRaw(entry.leading);
  }
  return entry.icon ? (
    <span className="toolbar-field-icon" data-tip-title={tipTitle}>
      <Icon name={iconName(entry.icon)} size={16} />
    </span>
  ) : undefined;
}
