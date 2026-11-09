/**
 * The single question the asset library is waiting on, plus the work its answer
 * asks for.
 *
 * The module owns request identity so a fresh prompt remounts its dialog with a
 * clean field; `submit` rejects with the message the dialog should show.
 */
import { createModalRequests } from "../../../../overlays/modals/requests.ts";

/**
 * A question the asset library is waiting on.
 *
 * The feature keeps the question and its answer; the dialog's shape lives in the
 * design system. `submit` does the work the answer asks for and rejects with the
 * message the dialog should show; the view takes the request down once that
 * settles, and on dismissal.
 */
export interface AssetNamePrompt {
  kind: "name";
  /** Identifies this request; a fresh one remounts the dialog, so its field starts clean. */
  id: number;
  title: string;
  /** The paragraph under the title; omit it when the title is enough. */
  description?: string;
  label: string;
  placeholder?: string;
  /** Starting text: the rename dialog opens on the name already in place. */
  value?: string;
  submit(value: string): Promise<void>;
}

/** The prompt the asset library can be waiting on. */
export type AssetPrompt = AssetNamePrompt;

/** What a caller hands over; the module owns the identity. */
export type AssetPromptRequest = Omit<AssetNamePrompt, "id">;

const prompt = createModalRequests<AssetPrompt>("asset");

export const getAssetPrompt = prompt.get;
export const subscribeAssetPrompt = prompt.subscribe;

/** Monotonic request identity; a new value remounts the dialog content. */
let nextId = 0;

/**
 * Shows a question.
 *
 * Every request reserves its place in the application queue.
 */
export function openAssetPrompt(request: AssetPromptRequest): void {
  nextId += 1;
  prompt.enqueue({ ...request, id: nextId });
}

/**
 * Takes the question down. The view calls this once the answer has been carried
 * out, and when the dialog is dismissed unanswered.
 */
export function closeAssetPrompt(): void {
  prompt.close();
}
