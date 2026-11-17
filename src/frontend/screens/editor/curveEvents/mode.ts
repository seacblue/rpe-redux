/**
 * Visibility cell for the non-modal curve preview editor.
 *
 * The curve-preview Inspector pane owns the mode: `paneSession.ts` sets this cell
 * from the pane lifecycle together with the camera it borrows. The stage,
 * renderer, and overlay read the cell, so the Inspector route is the only mode
 * owner.
 */
import { createValue } from "../../../../core/state/values.ts";

/** Whether the curve preview surface is active. */
export const curvePreviewMode = createValue<boolean>({ initial: false });
