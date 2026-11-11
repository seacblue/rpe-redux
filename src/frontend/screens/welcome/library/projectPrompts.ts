/**
 * The questions the home library waits on.
 *
 * Rename and remove requests carry their own submit work and are presented one at a
 * time through the shared dialog queue.
 */
import { createModalRequests } from "../../../overlays/modals/requests.ts";

/**
 * A question the home library is waiting on.
 *
 * The library keeps the question and its answer; the dialog's shape lives in the
 * design system. `submit` does the work the answer asks for and rejects with the
 * message the dialog should show; the view takes the request down once that
 * settles, and on dismissal.
 */
export interface ProjectRemovePrompt {
  kind: "remove";
  /** Identifies this request; a fresh one remounts the dialog, so it starts clean. */
  id: number;
  title: string;
  description: string;
  submit(): Promise<void>;
}

/** The editable library metadata shown in the rename dialog. */
export interface ProjectEditValues {
  name: string;
  composer: string;
  charter: string;
  level: string;
  group: string;
}

/** Renaming asks for the chart's library metadata, so the answer is the field set. */
export interface ProjectEditPrompt extends ProjectEditValues {
  kind: "edit";
  id: number;
  title: string;
  description: string;
  submit(values: ProjectEditValues): Promise<void>;
}

export type ProjectPrompt = ProjectRemovePrompt | ProjectEditPrompt;

/** What a caller hands over; the module owns the identity. */
export type ProjectPromptRequest = Omit<ProjectRemovePrompt, "id"> | Omit<ProjectEditPrompt, "id">;

const prompt = createModalRequests<ProjectPrompt>("project");

export const getProjectPrompt = prompt.get;
export const subscribeProjectPrompt = prompt.subscribe;

let nextId = 0;

/**
 * Shows a question.
 *
 * Every request reserves its place in the application queue.
 */
export function openProjectPrompt(request: ProjectPromptRequest): void {
  nextId += 1;
  prompt.enqueue({ ...request, id: nextId });
}

/**
 * Takes the question down. The view calls this once the answer has been carried
 * out, and when the dialog is dismissed unanswered.
 */
export function closeProjectPrompt(): void {
  prompt.close();
}
