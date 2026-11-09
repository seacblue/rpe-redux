/**
 * The create prompt for a new line, batch of lines, or line group.
 *
 * It is a pure Popconfirm form: the tree owns the draft value and the commit
 * handler, so this file only maps the draft to labels and the input control.
 */
import type { RefObject } from "react";
import { FieldRow } from "../../../../../design/components/field/FieldRow.tsx";
import { Input } from "../../../../../design/components/input/Input.tsx";
import { Popconfirm } from "../../../../../design/components/popconfirm/Popconfirm.tsx";
import { t } from "../../../../../i18n/index.ts";

/** One new line group may hold at most this many lines in a single batch. */
export const MAX_BATCH_LINES = 100;

/** The in-progress create dialog: kind, target folder, anchor, and draft value. */
export interface CreatePrompt {
  kind: "line" | "group";
  /** The folder new lines go into; ignored for groups. */
  group: number;
  anchor: HTMLElement;
  mode: "name" | "count";
  value: string;
}

interface LineTreeCreatePromptProps {
  prompt: CreatePrompt | null;
  labels: readonly string[];
  inputRef: RefObject<HTMLInputElement | null>;
  onValueChange(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}

/** Renders the create prompt; a null draft keeps the popover closed. */
export function LineTreeCreatePrompt({
  prompt,
  labels,
  inputRef,
  onValueChange,
  onCancel,
  onConfirm,
}: LineTreeCreatePromptProps) {
  return (
    <Popconfirm
      open={prompt !== null}
      anchor={prompt?.anchor ?? null}
      title={t(
        prompt?.mode === "count"
          ? prompt.kind === "line"
            ? "editorPanels.linePanel.addLinesTitle"
            : "editorPanels.linePanel.addGroupLabel"
          : prompt?.kind === "group"
            ? "editorPanels.linePanel.addGroup"
            : "editorPanels.linePanel.addLine",
      )}
      description={
        prompt?.mode === "count" && prompt.kind === "line"
          ? t("editorPanels.linePanel.addLinesDescription", {
              group: labels[prompt.group] ?? "",
            })
          : undefined
      }
      confirmLabel={t("common.action.confirm")}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <FieldRow
        density="compact"
        label={t(
          prompt?.mode === "count"
            ? prompt.kind === "line"
              ? "editorPanels.linePanel.addLinesCount"
              : "editorPanels.linePanel.groupCount"
            : prompt?.kind === "group"
              ? "editorPanels.linePanel.groupNamePlaceholder"
              : "editorPanels.linePanel.name",
        )}
        control={(id) => (
          <Input
            id={id}
            ref={inputRef}
            type={prompt?.mode === "count" ? "number" : "text"}
            {...(prompt?.mode === "count" ? { min: 1, max: MAX_BATCH_LINES, step: 1 } : {})}
            value={prompt?.value ?? ""}
            onChange={(event) => onValueChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onConfirm();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        )}
      />
    </Popconfirm>
  );
}
