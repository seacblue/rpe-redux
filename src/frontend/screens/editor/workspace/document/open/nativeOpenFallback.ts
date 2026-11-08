/**
 * Converts an external chart package when a native document open finds no RPE
 * chart inside it.
 *
 * The native reader understands RPE JSON documents and RPE PEZ packages. A PE
 * package carries `info.csv` beside a PEC text chart instead, so the native
 * reader rejects it with `pez_chart_missing`; that code is the one case this
 * module hands to the external-format converter. Every other failure keeps the
 * native wording and error surface.
 */
import { beginLoading, loadingProgress } from "../../../../../../core/global/document/loading.ts";
import {
  PEZ_CHART_MISSING_CODE,
  PEZ_CHART_MISSING_MESSAGE,
} from "../../../../../../core/platform/desktop/documentErrors.ts";

/** The two open strategies one fallback attempt needs. */
export interface NativeOpenFallbackPorts {
  /** The ordinary native open, including its own loading card. */
  open(path: string): Promise<void>;
  /**
   * Convert and open one external chart path; false when the path is not a
   * supported external format. Absent when the host has no converter, in which
   * case the native failure is rethrown unchanged.
   */
  importExternalChart?(path: string): Promise<boolean>;
}

/** True when a failed native open means the archive held no RPE chart entry. */
export function isMissingRpeChartError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  if ("code" in error && (error as { code?: unknown }).code === PEZ_CHART_MISSING_CODE) {
    return true;
  }
  return error instanceof Error && error.message.startsWith(PEZ_CHART_MISSING_MESSAGE);
}

/**
 * Open one native chart path, converting an external package when the native
 * reader finds no RPE chart in it.
 *
 * A successful conversion opens the imported library project and resolves. When
 * the archive is not an external format the failed load card is restored and the
 * original native failure is rethrown so callers keep reporting it, and a
 * conversion failure is rethrown because it is the useful diagnosis. The card is
 * dismissed while conversion runs so it cannot overlay the converted open.
 */
export async function openNativeChartPath(
  path: string,
  ports: NativeOpenFallbackPorts,
): Promise<void> {
  try {
    await ports.open(path);
    return;
  } catch (error) {
    if (!isMissingRpeChartError(error) || !ports.importExternalChart) {
      throw error;
    }
    loadingProgress.dismiss();
    const converted = await ports.importExternalChart(path);
    if (!converted) {
      // Not an external package: put the native failure back on the load card
      // so its error code and solution stay visible for the caller's report.
      const name = path.split(/[\\/]/).at(-1) ?? path;
      beginLoading(name).fail(error);
      throw error;
    }
  }
}
