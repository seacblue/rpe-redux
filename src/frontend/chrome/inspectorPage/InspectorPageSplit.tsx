/**
 * A split inspector page: two full-bleed scroll regions above and below one
 * full-width rule.
 *
 * The rule is fixed. It has no drag affordance, no grip, and no inset: it runs
 * from the inspector's left edge to its right edge so the body reads as one
 * interface divided into an upper and a lower half. Each face owns its own
 * content layer (and therefore its own gutter), which keeps both scrollbars on
 * the pane's outer edge.
 */
import type { ReactNode } from "react";

/** The two faces and the accessible names for their scroll regions. */
export interface InspectorPageSplitProps {
  top: ReactNode;
  bottom: ReactNode;
  /** Accessible names for the two scroll regions. */
  topLabel: string;
  bottomLabel: string;
}

/** A fixed list/properties split for a compact inspector page. */
export function InspectorPageSplit({
  top,
  bottom,
  topLabel,
  bottomLabel,
}: InspectorPageSplitProps) {
  return (
    <div className="inspector-page-split">
      <section
        className="inspector-page-split-face inspector-page-split-top"
        aria-label={topLabel}
        role="region"
      >
        <div className="inspector-page-content">{top}</div>
      </section>
      <div className="inspector-page-split-rule" role="separator" aria-orientation="horizontal" />
      <section
        className="inspector-page-split-face inspector-page-split-bottom"
        aria-label={bottomLabel}
        role="region"
      >
        <div className="inspector-page-content">{bottom}</div>
      </section>
    </div>
  );
}
