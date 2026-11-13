/**
 * One inspector page: a full-bleed scroll region and the content layer that
 * owns the page inset.
 *
 * The inspector frame never pads a pane. A single-face page wraps its body here
 * so the scrollbar stays on the pane's outer edge while the content keeps its
 * gutter; a split page uses `InspectorPageSplit` with the same content layer on
 * each face.
 */
import type { ReactNode } from "react";

/** Wraps one inspector page body in its scroll region and content inset. */
export function InspectorPage({ children }: { children: ReactNode }) {
  return (
    <div className="inspector-page">
      <div className="inspector-page-scroll">
        <div className="inspector-page-content">{children}</div>
      </div>
    </div>
  );
}
