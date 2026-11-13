/** Shared chart-parse worker messages so the host and worker use one protocol. */
import type { Chart, JudgeLine } from "../../../../../../core/global/chart/chart.ts";
import type { ChartLineRevisionSeed } from "../../../../../../core/global/chart/chartRevisionSeed.ts";
import type { ParsedChartEntries } from "../../../../../../core/global/document/chartParsing.ts";

/** One candidate header streamed before its judge lines. */
export interface ChartParseCandidateStart {
  name: string;
  chart: Chart;
  info?: Record<string, string>;
  desktop?: boolean;
  project?: {
    assetFolders?: string[];
    viewState?: { lineIndex?: number };
  } | null;
  diagnostics?: ParsedChartEntries["candidates"][number]["diagnostics"];
  readOnly?: boolean;
  normalized: boolean;
}

/** One request sent from the host to the chart parser worker. */
export interface ChartParseRequest {
  id: number;
  entries: Array<{ name: string; bytes: ArrayBuffer }>;
}

/** Messages emitted by the chart parser worker. */
export type ChartParseResponse =
  | {
      id: number;
      kind: "start";
      candidates: ChartParseCandidateStart[];
      errors: string[];
      issues: ParsedChartEntries["issues"];
    }
  | {
      id: number;
      kind: "lines";
      candidateIndex: number;
      lines: JudgeLine[];
      revisionSeeds: ChartLineRevisionSeed[];
    }
  | { id: number; kind: "done" };
