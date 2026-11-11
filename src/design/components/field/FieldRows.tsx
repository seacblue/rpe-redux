/**
 * A vertical list of `FieldRow`s.
 *
 * The container owns the space between rows; a row never carries a margin of
 * its own. That keeps settings pages, inspector panels, and modal bodies on one
 * rhythm instead of each surface re-deriving it (and occasionally getting it
 * wrong). Callers choose a named gap and, optionally, a divider between rows.
 */
import type { ReactNode } from "react";

/** Vertical rhythm presets for a field-row list. */
export type FieldRowsGap = "none" | "compact" | "normal" | "roomy";

/** Props for a field-row list. */
export interface FieldRowsProps {
  /** Space between rows; defaults to `normal`. */
  gap?: FieldRowsGap;
  /** Draw a divider between adjacent rows. */
  divided?: boolean;
  className?: string;
  children?: ReactNode;
}

/** The one container that owns field-row spacing. */
export function FieldRows({
  gap = "normal",
  divided = false,
  className = "",
  children,
}: FieldRowsProps) {
  return (
    <div
      className={`redux-field-rows${className ? ` ${className}` : ""}`}
      data-gap={gap}
      data-divided={divided ? "true" : undefined}
    >
      {children}
    </div>
  );
}
