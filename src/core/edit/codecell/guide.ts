/**
 * The mounted code-cell guide.
 *
 * `sdk/llm-guide.md` is the canonical author-facing guide; the application
 * entry imports it as text and binds it here. Keeping the binding separate lets
 * the Code Cell adapter stay transport-neutral and lets tests run without the bundle.
 */
import { createLateBound } from "../../utils/lateBound.ts";
import { filterAiGuide } from "./aiGuide.ts";

const FALLBACK_GUIDE = [
  "# RPE Redux code cells",
  "",
  "A cell is one async JavaScript function body. It receives `redux` and `input`,",
  "may use `console`, and returns a JSON value. The default write profile can read",
  "the open document and apply one atomic chart transaction; it cannot create,",
  'open, save, close, or delete documents or projects. Pass `profile: "read"` for',
  "a read-only run; `await redux.capabilities()` reports the exact grant list.",
  "",
  "POST `/api/cell/run` with `{ source, args?, expected?, timeoutMs? }`; the HTTP",
  "`POST /api/cell/run` body also accepts `profile`. A transaction can replace",
  "`timing.bpmList`, patch metadata, insert judge lines, and insert/update/delete",
  "notes and events. Notes and events use beat triples. Preview ids are valid only",
  "inside the cell that created them, and only one unused preview is retained.",
  "",
  "The full guide ships as `sdk/llm-guide.md`.",
].join("\n");

const guideBinding = createLateBound<string>();

/** Bind the bundled guide text; returns an idempotent disposer. */
export function connectCodeCellGuide(text: string): () => void {
  return guideBinding.bind(text);
}

/** The bundled guide, or a compact fallback when the app entry is not mounted. */
export function getCodeCellGuide(): string {
  return filterAiGuide(guideBinding.value() ?? FALLBACK_GUIDE);
}
