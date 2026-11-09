/**
 * Turns a registered command into the button the toolbar draws.
 *
 * The rows and the hidden bindings block share it, so a command looks and behaves
 * the same wherever it is placed.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Button } from "../../../design/components/button/Button.tsx";
import { IconButton } from "../../../design/components/button/IconButton.tsx";
import { Icon, iconName } from "../../../design/components/icon/Icon.tsx";
import {
  actionShortcut,
  actionShortcuts,
  runAction,
  type ToolbarAction,
} from "../../../core/shell/registries/toolbar.ts";
import { ariaShortcutText } from "../../../core/shortcuts/keys.ts";
import { onboardingAnchorRef } from "../../onboarding/anchors.ts";

/**
 * One command as the button that runs it.
 *
 * Shared by the rows and by the hidden bindings block, so a command looks and
 * behaves the same wherever the toolbar puts it. Returns `null` for a command
 * that belongs somewhere else: a menu-only action draws no button at all.
 */
export function toolbarActionNode(entry: ToolbarAction, tRaw: (key: string) => string): ReactNode {
  if (entry.visible?.() === false || entry.toolbar === false) {
    return null;
  }
  return (
    <MeasuredToolbarAction
      key={`${entry.id}:${entry.presentation ?? "icon"}:${tRaw(entry.label)}`}
      entry={entry}
      tRaw={tRaw}
    />
  );
}

interface MeasuredToolbarActionProps {
  entry: ToolbarAction;
  tRaw: (key: string) => string;
}

/** Render one action and resolve its automatic cell span after first layout. */
function MeasuredToolbarAction({ entry, tRaw }: MeasuredToolbarActionProps) {
  const isTextAction = entry.presentation === "text" || entry.presentation === "iconText";
  const automatic = entry.cells === undefined || entry.cells === "auto";
  const [measuredCells, setMeasuredCells] = useState<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!automatic) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const button = buttonRef.current;
      if (!button) {
        return;
      }
      if (!isTextAction) {
        setMeasuredCells(1);
        return;
      }
      const cellSize = Number.parseFloat(getComputedStyle(button).getPropertyValue("--tool-cell"));
      const text = button.querySelector<HTMLElement>(".redux-button-text");
      const labelNode = button.querySelector<HTMLElement>(".redux-button-label");
      const iconNode = text?.querySelector<HTMLElement>(".redux-icon");
      const textStyle = text ? getComputedStyle(text) : null;
      const buttonStyle = getComputedStyle(button);
      const gap = textStyle ? Number.parseFloat(textStyle.columnGap) || 0 : 0;
      const padding =
        (Number.parseFloat(buttonStyle.paddingLeft) || 0) +
        (Number.parseFloat(buttonStyle.paddingRight) || 0);
      const labelWidth = labelNode ? measureToolbarLabel(labelNode) : 0;
      const width = labelNode
        ? labelWidth + (iconNode?.getBoundingClientRect().width ?? 0) + gap + padding
        : button.scrollWidth;
      const next =
        Number.isFinite(cellSize) && cellSize > 0 ? Math.max(1, Math.ceil(width / cellSize)) : 1;
      setMeasuredCells(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [automatic, isTextAction]);

  const cells = automatic ? measuredCells : entry.cells;
  const style: CSSProperties & { "--toolbar-action-cells"?: number } =
    cells === null || cells === "auto" ? {} : { "--toolbar-action-cells": cells };
  const shortcuts = actionShortcuts(entry);
  const ariaShortcut = shortcuts[0] ? ariaShortcutText(shortcuts[0]) : "";
  const tips = {
    "data-tip-title": tRaw(entry.label),
    "data-tip-key": actionShortcut(entry),
    "data-tip-action": entry.id,
    "aria-keyshortcuts": ariaShortcut || undefined,
  };
  // The button runs the action it was registered with; there is no id lookup in
  // between, so a toolbar click is the same call as the feature's own API.
  const onClick = () => runAction(entry);
  const anchorRef = entry.domId ? onboardingAnchorRef(entry.domId) : undefined;
  if (entry.presentation && entry.presentation !== "icon") {
    return (
      <Button
        ref={(node) => {
          buttonRef.current = node;
          if (typeof anchorRef === "function") {
            anchorRef(node);
          }
        }}
        id={entry.domId}
        className={entry.domId ? `toolbar-action-${entry.domId}` : undefined}
        style={style}
        data-toolbar-cells={cells ?? "auto"}
        {...tips}
        disabled={entry.enabled?.() === false || entry.run === undefined}
        aria-pressed={entry.checked?.()}
        onClick={onClick}
      >
        <span className="redux-button-text">
          {entry.presentation === "iconText" && <Icon name={iconName(entry.icon)} size={18} />}
          <span className="redux-button-label">{tRaw(entry.label)}</span>
        </span>
      </Button>
    );
  }
  return (
    <IconButton
      ref={(node) => {
        buttonRef.current = node;
        if (typeof anchorRef === "function") {
          anchorRef(node);
        }
      }}
      id={entry.domId}
      className={entry.domId ? `toolbar-action-${entry.domId}` : undefined}
      style={style}
      data-toolbar-cells={cells ?? "auto"}
      icon={iconName(entry.icon)}
      label={tRaw(entry.label)}
      active={entry.checked?.()}
      {...tips}
      disabled={entry.enabled?.() === false || entry.run === undefined}
      onClick={onClick}
    />
  );
}

/** Measure a label without inheriting the toolbar button's current cell clamp. */
function measureToolbarLabel(labelNode: HTMLElement): number {
  const probe = labelNode.cloneNode(true) as HTMLElement;
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.width = "max-content";
  probe.style.minWidth = "max-content";
  probe.style.maxWidth = "none";
  probe.style.overflow = "visible";
  probe.style.flex = "none";
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}
