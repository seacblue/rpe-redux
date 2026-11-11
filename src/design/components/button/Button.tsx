/**
 * Base button primitive shared by shell, inspector, and dialog surfaces.
 *
 * It owns keyboard/focus semantics and the visual variants (`ghost`,
 * `outlined`, `solid`, `plain`, `danger`); callers own labels and actions. It
 * knows no product action, chart state, or panel layout.
 *
 * `ghost` is the default: a dense row gets a hover fill without a border.
 * `plain` is for rows that paint their own hover surface (menu rows, list rows).
 * `outlined` adds an edge for standalone secondary actions and message boxes.
 * `solid` is the primary action and `danger` is destructive.
 *
 * A glyph-plus-text button owns one label cell: bare string children beside an
 * {@link Icon} are wrapped in `.redux-button-label` here, so every caller gets
 * the shared optical centring. Without that cell the text ink sits a fraction of
 * a line above the glyph at some display scales and the icon reads as low.
 */
import {
  Children,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Icon } from "../icon/Icon.tsx";

/** Whether the caller already placed the design glyph among the children. */
function hasGlyph(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => isValidElement(child) && child.type === Icon);
}

/**
 * Wrap bare label text in the shared label cell.
 *
 * `actions.less` optically centres the text cell (CJK font ink is not symmetric
 * inside its line box) and keys that rule on `.redux-button-label`. A caller
 * that passes a plain string next to a glyph would otherwise lose the nudge.
 * Whitespace-only strings stay untouched; they collapse inside the flex row.
 */
function withLabelCell(children: ReactNode): ReactNode {
  let wrapped = false;
  const items = Children.toArray(children).map((child, index) => {
    if (typeof child !== "string" && typeof child !== "number") {
      return child;
    }
    if (typeof child === "string" && child.trim() === "") {
      return child;
    }
    wrapped = true;
    return (
      <span className="redux-button-label" key={`label-${index}`}>
        {child}
      </span>
    );
  });
  return wrapped ? items : children;
}
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  "data-tip-title"?: string;
  "data-tip-desc"?: string;
  "data-tip-key"?: string;
  "data-tip-action"?: string;
  "data-tip-video"?: string;
  /** Explicit surface variant; defaults to the dense `ghost` action. */
  variant?: "ghost" | "outlined" | "solid" | "plain" | "danger" | "link";
  /** Height and padding preset; `md` is the normal control and `lg` is page-level. */
  size?: "sm" | "md" | "lg";
  /** Tighter vertical rhythm for dense rows and cards. */
  density?: "default" | "compact";
  /** Fill the available inline space. */
  block?: boolean;
  /** Mark an icon-plus-label composition so the shared gap applies. */
  iconText?: boolean;
}
/** The shared button; forwards its ref to the native element and defaults to `type="button"`. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className = "",
    type = "button",
    variant = "ghost",
    size = "md",
    density = "default",
    block = false,
    iconText = false,
    title,
    children,
    ...props
  },
  ref,
) {
  const classes = [
    "redux-button",
    `redux-button-${variant}`,
    `redux-button-${size}`,
    density === "compact" ? "redux-button-dense" : "",
    block ? "redux-button-block" : "",
    iconText ? "redux-button-icon-text" : "",
    variant === "ghost" ? "redux-action" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const content = iconText || hasGlyph(children) ? withLabelCell(children) : children;
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      {...props}
      data-tip-title={props["data-tip-title"] ?? title}
    >
      {content}
    </button>
  );
});
