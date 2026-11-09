/**
 * Presentation state for joining or creating a collaboration room.
 *
 * The provider writes this cell while the room handshake, chart snapshot, and
 * required asset downloads run. The progress dialog reads it, so the surface
 * never needs to reconstruct transport state or guess whether a transfer has
 * finished. Every field is serializable and independent of the editor document.
 */
import { createValue, type ValueCell } from "../state/values.ts";
import type { Chart } from "../global/chart/chart.ts";
import type { RoomAsset } from "./types.ts";

/** Who opened the progress dialog. */
export type CollaborationProgressRole = "host" | "guest";

/** Coarse phases the dialog renders as a step list. */
export type CollaborationProgressPhase =
  | "preparing"
  | "bridge"
  | "connecting"
  | "waiting"
  | "chart"
  | "assets"
  | "publishing"
  | "ready"
  | "error";

/** The asset groups the dialog names separately. */
export type CollaborationProgressAssetKind = "audio" | "background" | "other";

/** Transfer state of one required asset. */
export type CollaborationProgressAssetState = "pending" | "downloading" | "done" | "error";

/** One required room asset and its verified byte progress. */
export interface CollaborationProgressAsset {
  readonly name: string;
  readonly kind: CollaborationProgressAssetKind;
  readonly state: CollaborationProgressAssetState;
  readonly received: number;
  readonly total: number;
}

/** Complete progress snapshot for one host/guest operation. */
export interface CollaborationProgressState {
  readonly visible: boolean;
  readonly role: CollaborationProgressRole;
  readonly phase: CollaborationProgressPhase;
  /** Host bridge selected for this attempt; guests keep the default. */
  readonly mode: "tunnel" | "lan";
  /** Tunnel substage from the native host, or an empty string before one arrives. */
  readonly detail: string;
  /** Diagnostic text; non-empty only in the error phase. */
  readonly error: string;
  /** The room handshake or chart snapshot has completed. */
  readonly chartReady: boolean;
  /** Every step and required asset has completed. */
  readonly ready: boolean;
  /** Required assets, in audio/background order. */
  readonly assets: readonly CollaborationProgressAsset[];
}

/** A hidden progress snapshot used before the first attempt and after teardown. */
export const EMPTY_COLLABORATION_PROGRESS: CollaborationProgressState = Object.freeze({
  visible: false,
  role: "guest",
  phase: "preparing",
  mode: "tunnel",
  detail: "",
  error: "",
  chartReady: false,
  ready: false,
  assets: Object.freeze([]),
});

/** Shared cell consumed by the progress dialog and written by the provider. */
export const collaborationProgress: ValueCell<CollaborationProgressState> =
  createValue<CollaborationProgressState>({
    initial: EMPTY_COLLABORATION_PROGRESS,
  });

/** Start one visible attempt for the given role and host bridge. */
export function startRoomProgress(
  role: CollaborationProgressRole,
  mode: "tunnel" | "lan" = "tunnel",
): CollaborationProgressState {
  return {
    ...EMPTY_COLLABORATION_PROGRESS,
    visible: true,
    role,
    mode,
    phase: role === "host" ? "preparing" : "connecting",
    assets: Object.freeze([]),
  };
}

/** Read the chart metadata fields that must exist in a room's asset manifest. */
function requiredAssetReferences(chart: unknown): readonly {
  readonly name: string;
  readonly kind: Exclude<CollaborationProgressAssetKind, "other">;
}[] {
  if (!chart || typeof chart !== "object") {
    return [];
  }
  const meta = (chart as Chart).META;
  if (!meta || typeof meta !== "object") {
    return [];
  }
  const references: { name: string; kind: "audio" | "background" }[] = [];
  const add = (name: unknown, kind: "audio" | "background") => {
    if (
      typeof name === "string" &&
      name.trim() &&
      !references.some((entry) => entry.name === name)
    ) {
      references.push({ name, kind });
    }
  };
  add(meta.song, "audio");
  add(meta.background, "background");
  return references;
}

/**
 * Build the required-asset rows for one chart.
 *
 * Only entries present in the room manifest become rows. A chart-declared name
 * without an uploaded manifest entry has no bytes to wait for; the editor's
 * normal missing-asset reporting owns that case instead of leaving the progress
 * dialog stuck.
 */
export function requiredRoomAssetRows(
  chart: unknown,
  manifest: readonly RoomAsset[],
): CollaborationProgressAsset[] {
  const byName = new Map(manifest.map((asset) => [asset.name, asset]));
  return requiredAssetReferences(chart).flatMap((reference) => {
    const asset = byName.get(reference.name);
    if (!asset) {
      return [];
    }
    return [
      {
        name: reference.name,
        kind: reference.kind,
        state: "pending" as const,
        received: 0,
        total: asset.size,
      },
    ];
  });
}

/** Merge one client transfer event into the row with the same asset name. */
export function withAssetProgress(
  rows: readonly CollaborationProgressAsset[],
  event: {
    readonly name: string;
    readonly state: "begin" | "progress" | "done";
    readonly received: number;
    readonly total: number;
  },
): CollaborationProgressAsset[] {
  return rows.map((row) => {
    if (row.name !== event.name) {
      return row;
    }
    return {
      ...row,
      state: event.state === "done" ? "done" : "downloading",
      received:
        event.state === "done"
          ? Math.max(event.total, event.received)
          : Math.max(0, Math.min(event.received, event.total || event.received)),
      total: event.total || row.total,
    };
  });
}

/** Mark one required asset as arrived, even when no byte event reached the UI. */
export function markAssetDone(
  rows: readonly CollaborationProgressAsset[],
  name: string,
): CollaborationProgressAsset[] {
  return rows.map((row) =>
    row.name === name ? { ...row, state: "done", received: row.total } : row,
  );
}

/** Mark one required asset as failed so the dialog stays open with a reason. */
export function markAssetError(
  rows: readonly CollaborationProgressAsset[],
  name: string,
): CollaborationProgressAsset[] {
  return rows.map((row) => (row.name === name ? { ...row, state: "error" } : row));
}

/** Mark every required asset not present in the client's missing list as done. */
export function markPresentAssetsDone(
  rows: readonly CollaborationProgressAsset[],
  missing: readonly string[],
): CollaborationProgressAsset[] {
  return rows.map((row) =>
    missing.includes(row.name)
      ? { ...row, state: "downloading" }
      : { ...row, state: "done", received: row.total },
  );
}

/** Whether every required asset has verified bytes. */
export function roomAssetsReady(rows: readonly CollaborationProgressAsset[]): boolean {
  return rows.every((row) => row.state === "done");
}

/** Whether a guest may auto-close the progress dialog. */
export function guestProgressReady(progress: CollaborationProgressState): boolean {
  return (
    progress.role === "guest" &&
    progress.chartReady &&
    !progress.error &&
    roomAssetsReady(progress.assets)
  );
}

/** Clamp one asset row to a 0..1 ratio for the progress bar. */
export function assetProgressRatio(row: CollaborationProgressAsset): number {
  if (row.total <= 0) {
    return row.state === "done" ? 1 : 0;
  }
  return Math.max(0, Math.min(1, row.received / row.total));
}
