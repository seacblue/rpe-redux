/**
 * Bodies and footer actions for the shell's prompts.
 *
 * Choice, confirm, input, select, and notice requests share these pieces
 * so every prompt reads and answers the same way.
 */
import { useId, type KeyboardEvent } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { ChoiceList } from "../../../design/components/modal/ChoiceList.tsx";
import { FieldRow } from "../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../design/components/input/Input.tsx";
import { Textarea } from "../../../design/components/input/Textarea.tsx";
import { useTranslation } from "../../../i18n/react.ts";
import type { ScriptUiSelectOption } from "../../../core/extensions/scriptUi.ts";

/** Cancel and confirm buttons shared by confirm, input, and select prompts. */
export function PromptActions({
  confirm,
  label,
  cancelLabel,
  destructive = false,
  settle,
}: {
  confirm: boolean;
  label?: string;
  cancelLabel?: string;
  /** Destructive answers carry the danger surface so the choice reads before the click. */
  destructive?: boolean;
  settle(accepted: boolean): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="outlined" onClick={() => settle(false)}>
        {cancelLabel ?? t("common.action.cancel")}
      </Button>
      {confirm && (
        <Button variant={destructive ? "danger" : "solid"} onClick={() => settle(true)}>
          {label ?? t("common.action.confirm")}
        </Button>
      )}
    </>
  );
}

/**
 * Choices that answer a whole request, so they belong in the modal footer.
 *
 * A choice prompt has no separate cancel answer: closing the surface is the
 * cancel path. Rendering the answers as footer buttons keeps every modal's
 * decision row at the bottom and out of the body text.
 */
export function ChoiceActions({
  labels,
  choose,
}: {
  labels: readonly string[];
  choose(index: number): void;
}) {
  return (
    <>
      {labels.map((label, index) => (
        <Button
          key={`${index}:${label}`}
          variant="outlined"
          className="modal-choice-action"
          onClick={() => choose(index)}
        >
          {label}
        </Button>
      ))}
    </>
  );
}

/** One footer answer whose value is chosen by the caller. */
export interface ActionChoice<T extends string> {
  readonly value: T;
  readonly label: string;
  /** The surface the answer uses; defaults to the secondary outline. */
  readonly variant?: "solid" | "outlined" | "danger";
}

/** Footer for a caller-defined set of answers, preserving the supplied order. */
export function ActionChoiceActions<T extends string>({
  choices,
  choose,
}: {
  choices: readonly ActionChoice<T>[];
  choose(value: T): void;
}) {
  return (
    <>
      {choices.map((choice) => (
        <Button
          key={`${choice.value}:${choice.label}`}
          variant={choice.variant ?? "outlined"}
          onClick={() => choose(choice.value)}
        >
          {choice.label}
        </Button>
      ))}
    </>
  );
}

/** The three answers a document-close prompt can return. */
export type ExitChoice = "save" | "discard" | "cancel";

/** Footer for a three-way save/discard/cancel decision. */
export function ExitActions({
  saveLabel,
  discardLabel,
  cancelLabel,
  choose,
}: {
  saveLabel: string;
  discardLabel: string;
  cancelLabel?: string;
  choose(choice: ExitChoice): void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="outlined" onClick={() => choose("cancel")}>
        {cancelLabel ?? t("common.action.cancel")}
      </Button>
      <Button variant="danger" onClick={() => choose("discard")}>
        {discardLabel}
      </Button>
      <Button variant="solid" onClick={() => choose("save")}>
        {saveLabel}
      </Button>
    </>
  );
}

/** Renders select options as a choice list, or an empty notice when all are disabled. */
export function PromptSelect({
  choices,
  selectedValue,
  choose,
}: {
  choices: readonly ScriptUiSelectOption[];
  selectedValue?: string;
  choose(value: string): void;
}) {
  const { t } = useTranslation();
  const enabled = choices.some((choice) => !choice.disabled);
  if (!enabled) {
    return <div className="redux-select-empty">{t("design.select.empty")}</div>;
  }
  return (
    <ChoiceList
      choices={choices.map((choice, key) => ({
        key,
        label: choice.label,
        disabled: choice.disabled,
        selected: choice.value === selectedValue && !choice.disabled,
      }))}
      onChoose={(index) => {
        const choice = choices[index];
        if (choice && !choice.disabled) {
          choose(choice.value);
        }
      }}
    />
  );
}

/** Single close button for a notice prompt. */
export function NoticeActions({ close }: { close(): void }) {
  const { t } = useTranslation();
  return (
    <Button variant="outlined" onClick={close}>
      {t("common.action.close")}
    </Button>
  );
}

/** Text field or textarea for an input prompt; Enter submits single-line input. */
export function PromptInput({
  inputRef,
  title,
  label,
  defaultValue,
  placeholder,
  multiline,
  submit,
}: {
  inputRef: { current: HTMLInputElement | HTMLTextAreaElement | null };
  title: string;
  /** The visible row label; an empty label leaves the control full width. */
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  multiline?: boolean;
  submit(): void;
}) {
  const id = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!multiline && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };
  const control = multiline ? (
    <Textarea
      id={id}
      ref={(node) => {
        inputRef.current = node;
      }}
      rows={6}
      defaultValue={defaultValue}
      placeholder={placeholder}
      aria-label={title}
      autoComplete="off"
      onKeyDown={onKeyDown}
    />
  ) : (
    <Input
      id={id}
      ref={(node) => {
        inputRef.current = node;
      }}
      type="text"
      defaultValue={defaultValue}
      placeholder={placeholder}
      aria-label={title}
      onKeyDown={onKeyDown}
    />
  );
  if (!label) {
    return control;
  }
  return (
    <FieldRow
      layout="inline"
      className="modal-field"
      htmlFor={id}
      label={label}
      control={control}
    />
  );
}

/** Cancel and submit footer for an input prompt, with optional pending disablement. */
export function InputActions({
  confirmLabel,
  cancelLabel,
  cancel,
  submit,
  cancelDisabled = false,
  submitDisabled = false,
  submitVariant = "solid",
}: {
  confirmLabel?: string;
  cancelLabel?: string;
  cancel(): void;
  submit(): void;
  cancelDisabled?: boolean;
  submitDisabled?: boolean;
  submitVariant?: "solid" | "danger";
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant="outlined" disabled={cancelDisabled} onClick={cancel}>
        {cancelLabel ?? t("common.action.cancel")}
      </Button>
      <Button variant={submitVariant} disabled={submitDisabled} onClick={submit}>
        {confirmLabel ?? t("common.action.apply")}
      </Button>
    </>
  );
}
