/**
 * Desktop adapter for reading external chart folders and writing single-file
 * exports.
 *
 * The native scan owns folder enumeration and sidecar discovery. Conversion,
 * metadata merging and library writes stay in the frontend importer; archive
 * unpacking stays in the shared ZIP reader.
 */
import { invoke } from "@tauri-apps/api/core";

/** One metadata sidecar returned by the native folder scan. */
export interface ExternalSidecar {
  readonly name: string;
  readonly text: string;
}

/** One audio or image candidate beside a chart. */
export interface ExternalMedia {
  readonly name: string;
  readonly path: string;
  readonly size: number;
}

/** A chart file, its sidecars and its media candidates. */
export interface ExternalChartScan {
  readonly root: string;
  readonly chartPath: string;
  readonly chartName: string;
  readonly chartText: string;
  readonly sidecars: readonly ExternalSidecar[];
  readonly media: readonly ExternalMedia[];
  readonly warnings: readonly string[];
}

/** Read one selected chart file or folder through the native scanner. */
export function scanExternalChart(path: string): Promise<ExternalChartScan> {
  return invoke<ExternalChartScan>("scan_external_chart", { path });
}

/** Read one selected path as bytes without routing a number array through JSON. */
export async function readPickedBytes(path: string): Promise<Uint8Array> {
  const response = await invoke<ArrayBuffer | number[]>("read_picked_file", { path });
  return response instanceof ArrayBuffer ? new Uint8Array(response) : Uint8Array.from(response);
}

/** Write one exported JSON or PEC text file chosen by the native save dialog. */
export async function writeExportText(path: string, text: string): Promise<string> {
  return invoke<string>("write_export_text", { path, text });
}

/** Write a binary single-file export through the host's atomic writer. */
export async function writeExportBytes(path: string, bytes: Uint8Array): Promise<string> {
  return invoke<string>("write_export_bytes", { path, bytes: [...bytes] });
}
