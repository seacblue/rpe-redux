/**
 * Chrome around the judge-line tree: the add/delete footer and the marquee
 * rectangle.
 *
 * These pieces render outside the scrolling list but belong to the same panel,
 * so they take their already-computed state and emit intents upward.
 */
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "../../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../../design/components/icon/Icon.tsx";
import { t } from "../../../../../i18n/index.ts";
import { readTimelineNoteMarqueeColors } from "../../../editor/canvas/palette.ts";

interface LineTreeFooterProps {
  deleteEnabled: boolean;
  selectedGroupHasLines: boolean;
  onBeginCreatePress(event: ReactPointerEvent<HTMLButtonElement>, kind: "line" | "group"): void;
  onEndCreatePress(): void;
  onCreate(kind: "line" | "group", event: ReactMouseEvent<HTMLButtonElement>): void;
  onDelete(): void;
}

/** Add-line, add-group, and delete actions pinned under the list. */
export function LineTreeFooter({
  deleteEnabled,
  selectedGroupHasLines,
  onBeginCreatePress,
  onEndCreatePress,
  onCreate,
  onDelete,
}: LineTreeFooterProps) {
  const deleteLabel = t(
    selectedGroupHasLines
      ? "editorPanels.linePanel.deleteLabel"
      : "editorPanels.linePanel.deleteGroupLabel",
  );
  return (
    <div className="line-tree-footer redux-footer-bar redux-footer-bar-compact">
      <Button
        type="button"
        variant="solid"
        block
        data-tip-desc={t("editorPanels.linePanel.addLineHint")}
        onPointerDown={(event) => onBeginCreatePress(event, "line")}
        onPointerUp={onEndCreatePress}
        onPointerCancel={onEndCreatePress}
        onPointerLeave={onEndCreatePress}
        onClick={(event) => onCreate("line", event)}
      >
        <Icon name="plus" size={14} />
        <span className="redux-button-label">{t("editorPanels.linePanel.addLine")}</span>
      </Button>
      <div className="line-tree-footer-actions redux-footer-actions">
        <Button
          type="button"
          variant="outlined"
          data-tip-desc={t("editorPanels.linePanel.addGroupHint")}
          onPointerDown={(event) => onBeginCreatePress(event, "group")}
          onPointerUp={onEndCreatePress}
          onPointerCancel={onEndCreatePress}
          onPointerLeave={onEndCreatePress}
          onClick={(event) => onCreate("group", event)}
        >
          <Icon name="plus" size={14} />
          <span className="redux-button-label">{t("editorPanels.linePanel.addGroup")}</span>
        </Button>
        <Button type="button" variant="danger" disabled={!deleteEnabled} onClick={onDelete}>
          <Icon name="trash" size={14} />
          <span className="redux-button-label">{deleteLabel}</span>
        </Button>
      </div>
    </div>
  );
}

interface LineTreeMarqueeBoxProps {
  box: { left: number; top: number; width: number; height: number } | null;
}

/** The shift-drag selection rectangle, positioned in client coordinates. */
export function LineTreeMarqueeBox({ box }: LineTreeMarqueeBoxProps) {
  if (!box) {
    return null;
  }
  const colors = readTimelineNoteMarqueeColors();
  return (
    <div
      className="line-tree-marquee"
      style={
        {
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          "--line-selection-marquee-fill": colors.fill,
          "--line-selection-marquee-stroke": colors.stroke,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}
