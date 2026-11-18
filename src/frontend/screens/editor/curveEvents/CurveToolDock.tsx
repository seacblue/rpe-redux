/**
 * Floating curve tool list.
 *
 * It is a flat set of outline-style rows: four creation tools, a divider, three
 * editing tools, a divider, and reverse. There is no library header, description,
 * or close chrome; the whole dock is draggable from its grip/background.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { Icon, type IconName } from "../../../../design/components/icon/Icon.tsx";
import { Button } from "../../../../design/components/button/Button.tsx";
import { t, type MessageKey } from "../../../../i18n/index.ts";
import { CURVE_CREATION_TOOLS, CURVE_EDIT_TOOLS, type CurveTool } from "./curveTools.ts";

export interface CurveToolDockProps {
  tool: CurveTool;
  position: { x: number; y: number };
  onToolChange(tool: CurveTool): void;
  onDragPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onHoverChange(hovered: boolean): void;
  onReverse(): void;
}

/** One tool button row: icon, localized label, and pressed state. */
function ToolRow({
  id,
  icon,
  label,
  active,
  onSelect,
}: {
  id: CurveTool;
  icon: IconName;
  label: string;
  active: boolean;
  onSelect(): void;
}) {
  return (
    <Button className="curve-tool-row" data-tool={id} aria-pressed={active} onClick={onSelect}>
      <Icon name={icon} size={16} />
      <span>{t(label as MessageKey)}</span>
    </Button>
  );
}

/** Floating tool list; non-button areas drag the dock and rows switch tools. */
export function CurveToolDock({
  tool,
  position,
  onToolChange,
  onDragPointerDown,
  onHoverChange,
  onReverse,
}: CurveToolDockProps) {
  return (
    <div
      className="curve-tool-dock"
      style={{ left: position.x, top: position.y }}
      data-tool={tool}
      onPointerDown={onDragPointerDown}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
    >
      <span className="curve-tool-grip" aria-hidden="true" />
      <div
        className="curve-tool-list"
        role="toolbar"
        aria-label={t("editorPanels.curvePreview.authoring.tools")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {CURVE_CREATION_TOOLS.map((entry) => (
          <ToolRow
            key={entry.id}
            {...entry}
            active={tool === entry.id}
            onSelect={() => onToolChange(entry.id)}
          />
        ))}
        <span className="curve-tool-divider" aria-hidden="true" />
        {CURVE_EDIT_TOOLS.map((entry) => (
          <ToolRow
            key={entry.id}
            {...entry}
            active={tool === entry.id}
            onSelect={() => onToolChange(entry.id)}
          />
        ))}
        <span className="curve-tool-divider" aria-hidden="true" />
        <Button className="curve-tool-row" data-action="reverse" onClick={onReverse}>
          <Icon name="reverse" size={16} />
          <span>{t("editorPanels.curvePreview.tool.reverse")}</span>
        </Button>
      </div>
    </div>
  );
}
