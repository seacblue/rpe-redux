/**
 * Renders normalized failures in an owner-controlled inline alert.
 *
 * The component keeps field and progress surfaces local while reusing the
 * editor's code-to-copy policy; it never creates a toast or modal as a side
 * effect.
 */
import { InlineAlert } from "../../../../../../design/components/alert/InlineAlert.tsx";
import { resolveEditorFailure, type EditorFailurePresentation } from "./feedbackPolicy.ts";
import type { FailureContext } from "../../../../../../core/contracts/failure.ts";

/** Props for one inline failure owner. */
export interface FailureAlertProps {
  readonly error: unknown;
  readonly context?: Omit<FailureContext, "owner">;
  readonly className?: string;
}

/** Render one localized normalized failure without changing its presentation owner. */
export function FailureAlert({ error, context, className }: FailureAlertProps) {
  const presentation: EditorFailurePresentation = resolveEditorFailure(error, {
    owner: "inline",
    operation: "editor.inline",
    ...context,
  });
  if (presentation.surface !== "inline") {
    return null;
  }
  return (
    <InlineAlert
      tone={presentation.level === "warning" ? "warning" : "danger"}
      className={className}
    >
      {presentation.message}
    </InlineAlert>
  );
}
