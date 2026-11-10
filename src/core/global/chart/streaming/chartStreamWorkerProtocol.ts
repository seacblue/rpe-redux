/**
 * Message contract between the editor and the chart stream worker. The worker
 * owns the source text and index; the editor requests only the lines it needs.
 */
import type { ChartHeader, ChartIndex } from "./chartStreamTypes.ts";

/** Requests sent to the chart stream worker. */
export type ChartWorkerRequest =
  | { readonly id: number; readonly kind: "open"; readonly bytes?: ArrayBuffer }
  | { readonly id: number; readonly kind: "append"; readonly chunk: ArrayBuffer }
  | { readonly id: number; readonly kind: "finish" }
  | { readonly id: number; readonly kind: "line"; readonly index: number }
  | { readonly id: number; readonly kind: "close" };

/** Responses sent back by the chart stream worker. */
export type ChartWorkerResponse =
  | { readonly id: number; readonly kind: "header"; readonly header: ChartHeader }
  | { readonly id: number; readonly kind: "index"; readonly index: ChartIndex }
  | {
      readonly id: number;
      readonly kind: "line";
      readonly index: number;
      readonly raw: string | null;
    }
  | { readonly id: number; readonly kind: "error"; readonly message: string };
