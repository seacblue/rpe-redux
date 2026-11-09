/**
 * Keyboard handling for the curve trajectory overlay.
 *
 * Escape unwinds the current gesture, then the selection, then the mode.
 * Delete is a registered editor shortcut (`editor.curve.delete`) rather than a
 * local listener, so it appears in the shortcut settings and respects text
 * entry. This hook only owns the overlay's local gesture/selection unwinding.
 */
import { useEffect, useRef } from "react";
import { isSystemCancelKey } from "../../../../core/shortcuts/keyMatching.ts";
import { t } from "../../../../i18n/index.ts";
import type { CurveTool } from "./curveTools.ts";
import type { SegmentTarget } from "./pathModel.ts";
import { isTextTarget, TOOL_HINTS } from "./overlayModel.ts";
import { updateCurvePreview } from "./store.ts";

interface CurveOverlayKeyboardOptions {
  active: boolean;
  /** Only draw mode owns a path selection that Escape can unwind. */
  drawing: boolean;
  selectedId: string | null;
  selectedSegment: SegmentTarget | null;
  tool: CurveTool;
  connectFirstId: string | null;
  hasDraft: () => boolean;
  cancelDraft(): void;
  cancelConnect(): void;
  clearSelection(): void;
  close(): void;
}

/**
 * Bind Escape while the overlay is active.
 *
 * Escape cancels a draft, then a pending connect, then the selection, and
 * finally closes the mode. Delete is a registered editor shortcut, not handled
 * here.
 */
export function useCurveOverlayKeyboard(options: CurveOverlayKeyboardOptions): void {
  const latest = useRef(options);
  latest.current = options;
  const { active } = options;

  useEffect(() => {
    /** Unwind the innermost active gesture, selection, or mode. */
    const onKey = (event: KeyboardEvent) => {
      const current = latest.current;
      if (!current.active || isTextTarget(event.target)) {
        return;
      }
      if (isSystemCancelKey(event)) {
        event.preventDefault();
        if (current.hasDraft()) {
          current.cancelDraft();
          updateCurvePreview({ status: t(TOOL_HINTS[current.tool]) });
        } else if (current.connectFirstId) {
          current.cancelConnect();
          updateCurvePreview({ status: t(TOOL_HINTS[current.tool]) });
        } else if (current.drawing && (current.selectedId || current.selectedSegment)) {
          current.clearSelection();
          updateCurvePreview({ status: t(TOOL_HINTS[current.tool]) });
        } else {
          current.close();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
