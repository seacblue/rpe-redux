/**
 * Transferable chart revision metadata produced while a chart is parsed.
 *
 * The seed is deliberately data-only: importers may produce it, document
 * installers may register it, and editor revision code may consume it without
 * making those modules depend on one another.
 */

/** Content digest for one judge line and its unchanged top-level children. */
export interface ChartLineRevisionSeed {
  readonly digest: string;
  readonly childDigests: Readonly<Record<string, number>>;
  /** Post-order hashes for materialized objects, used by copy-on-write edits. */
  readonly valueDigests?: readonly ChartValueDigestGroup[];
}

/** Revision metadata for the ordered judge-line list of one chart. */
export interface ChartRevisionSeed {
  readonly lines: readonly ChartLineRevisionSeed[];
}
import type { ChartValueDigestGroup } from "./chartContentHash.ts";
