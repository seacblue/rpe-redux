/**
 * The fields in the home screen's chart-details dialog.
 *
 * The view is controlled by the dialog that mounts it, which keeps the answer
 * current with what is on screen. The first four fields mirror the detail card:
 * title, composer, charter, and difficulty.
 */
import type { KeyboardEvent } from "react";
import { FieldRow } from "../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../design/components/input/Input.tsx";
import { t } from "../../../../i18n/index.ts";
import type { ProjectEditValues } from "./projectPrompts.ts";

/** Props for the controlled chart-details fields. */
interface HomeProjectDialogViewProps {
  /**
   * The field text. The dialog owns it rather than this view: the answer has to
   * be what is on screen when the footer's button runs, and a copy kept here
   * would be a second source for the same value.
   */
  value: ProjectEditValues;
  onChange(value: ProjectEditValues): void;
  /** Enter applies, exactly as the footer's button does. */
  onEnter?(): void;
}

/** Fields in the chart-details dialog. */
export function HomeProjectDialogView({ value, onChange, onEnter }: HomeProjectDialogViewProps) {
  /** Applies the dialog when Enter is pressed in any field. */
  const applyOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onEnter?.();
    }
  };
  /** Replaces one field and leaves the rest of the answer untouched. */
  const set = (key: keyof ProjectEditValues, text: string) => {
    onChange({ ...value, [key]: text });
  };
  const field = (key: keyof ProjectEditValues, id: string, label: string) => (
    <FieldRow
      layout="inline"
      className="modal-field"
      htmlFor={id}
      label={label}
      control={
        <Input
          id={id}
          value={value[key]}
          onKeyDown={applyOnEnter}
          onChange={(event) => set(key, event.currentTarget.value)}
        />
      }
    />
  );
  return (
    <>
      {field("name", "home-project-name", t("editor.home.field.nameLabel"))}
      {field("composer", "home-project-composer", t("workspace.welcome.library.field.composer"))}
      {field("charter", "home-project-charter", t("workspace.welcome.library.field.charter"))}
      {field("level", "home-project-level", t("workspace.welcome.library.field.level"))}
      {field("group", "home-project-group", t("editor.home.field.groupLabel"))}
    </>
  );
}
