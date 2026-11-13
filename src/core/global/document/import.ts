/**
 * Opens dropped or picked files as chart candidates.
 *
 * A single archive goes through `readPez`; loose files become an asset map for
 * `parseChartEntries`. Progress and failures flow through `LoadTask` and
 * `ChartLoadError`.
 */
import { t } from "../../../i18n/index.ts";
import { ChartLoadError } from "../chart/diagnostics.ts";
import { readPez, type ArchiveReader, type ChartDocumentFactory } from "./pez.ts";
import type { LoadTask } from "./loading.ts";
import type { OpenCandidate } from "./types.ts";
import { attachExternalEffects } from "./effects.ts";
import { parseChartEntries, type ChartEntryParser } from "./chartParsing.ts";

/** A picked or dropped file whose bytes are read on demand. */
export interface NamedBinaryFile {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Read a dropped or picked selection into open candidates and its asset map.
 *
 * A single PEZ/ZIP archive is unpacked; otherwise every file joins a loose
 * asset map. Returns `null` for an empty selection and throws `ChartLoadError`
 * when no chart entry parses.
 */
export async function openFiles(
  fileList: Iterable<NamedBinaryFile>,
  task?: LoadTask,
  parseCharts: ChartEntryParser = parseChartEntries,
  readArchive?: ArchiveReader,
  createChartDocument?: ChartDocumentFactory,
): Promise<{ candidates: OpenCandidate[]; assets: Map<string, Uint8Array> } | null> {
  const files = [...fileList];
  if (!files.length) {
    return null;
  }
  const assets = new Map<string, Uint8Array>();
  if (files.length === 1 && /\.(pez|zip)$/i.test(files[0].name)) {
    const buffer = await files[0].arrayBuffer();
    task?.update("read", 1, 1);
    const opened = await readPez(buffer, task, parseCharts, readArchive, createChartDocument);
    attachExternalEffects(opened.candidates, opened.assets);
    return opened;
  } else {
    for (const file of files) {
      assets.set(file.name, new Uint8Array(await file.arrayBuffer()));
    }
  }
  const candidates: OpenCandidate[] = [];
  const parsed = await parseCharts(assets);
  candidates.push(...parsed.candidates);
  if (!candidates.length) {
    throw new ChartLoadError(
      parsed.issues.length
        ? parsed.issues
        : [
            {
              id: "document:no-candidate",
              category: "document",
              path: "$",
              messageKey: "model.chart.invalidDocument",
            },
          ],
      parsed.errors.join("\n") || t("system.files.chartNotFound"),
    );
  }
  attachExternalEffects(candidates, assets);
  return { candidates, assets };
}
