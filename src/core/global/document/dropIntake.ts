/**
 * The route a dropped path takes after the local service classifies it.
 *
 * The Go intake route owns filesystem inspection; these types mirror its
 * response and turn the answer into the small set of actions the home runtime
 * already owns. Keeping the policy here makes the mapping testable without a
 * live service or a Tauri window.
 */

/** Owners the intake service can identify. */
export type DropKind = "chart" | "extension" | "skin" | "unknown";

/** Chart formats the editor can import. */
export type DropChartFormat = "rpe" | "official" | "pec";

/** One classified path, as `POST /api/intake/classify` returns it. */
export interface DropClassification {
  /** The path exactly as it was dropped. */
  path: string;
  kind: DropKind;
  /** Chart format; absent for packages and unknown items. */
  format?: DropChartFormat;
  /** Display name from chart metadata, a manifest, or info.yml. */
  name?: string;
  /** Path the winning importer or settings surface should target. */
  entry?: string;
  /** Chart files when a folder or archive holds more than one. */
  candidates?: string[];
  /** Extension manifest id. */
  packageId?: string;
  /** False when the package shell was recognized but failed basic checks. */
  valid: boolean;
  /** English diagnostic for logs; not shown as a localized message. */
  reason?: string;
}

/** Consequence of one classification. */
export type DropRoute =
  | { action: "chart-rpe"; path: string; entry: string }
  | { action: "chart-external"; path: string; format: "official" | "pec" }
  | { action: "extension"; item: DropClassification }
  | { action: "skin"; item: DropClassification }
  | { action: "unsupported"; item: DropClassification };

/**
 * Choose the owning surface for one classification.
 *
 * RPE charts stay with the migration/document opener because the service can
 * return either a chart file or an RPE root. Official and PEC charts use the
 * external importer. Packages stop at their settings surface; the classifier
 * never installs code or writes a skin by itself.
 */
export function dropRoute(item: DropClassification): DropRoute {
  if (item.kind === "extension") {
    return { action: "extension", item };
  }
  if (item.kind === "skin") {
    return { action: "skin", item };
  }
  if (item.kind !== "chart") {
    return { action: "unsupported", item };
  }
  const entry = item.entry || item.path;
  if (item.format === "rpe") {
    return { action: "chart-rpe", path: item.path, entry };
  }
  if (item.format === "official" || item.format === "pec") {
    return { action: "chart-external", path: entry, format: item.format };
  }
  return { action: "unsupported", item };
}
