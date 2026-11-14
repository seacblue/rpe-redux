/** Identifies source files that are safe to reopen for library asset repair. */
import type { DropClassification } from "../../../core/global/document/dropIntake.ts";

/** Return true only for a native RPE chart that can be reopened as JSON. */
export function shouldRepairLibraryAssetsFromNativeRpe(
  item: Pick<DropClassification, "kind" | "format" | "peInstallation"> | null | undefined,
): boolean {
  return item?.kind === "chart" && item.format === "rpe" && item.peInstallation !== true;
}
