/** Keeps a bounded, redacted sequence of semantic actions and runtime issues. */
import { redactDiagnosticText } from "./redaction.ts";

/** Where a semantic action entered the application. */
export type DiagnosticActionSource =
  "toolbar" | "menu" | "context_menu" | "shortcut" | "gesture" | "system";

/** Whether an action completed or was rejected by its current state. */
export type DiagnosticActionOutcome = "completed" | "ignored" | "failed";

/** One input-free semantic operation retained for the support bundle. */
export interface DiagnosticActionEntry {
  readonly at: number;
  readonly id: string;
  readonly source: DiagnosticActionSource;
  readonly outcome: DiagnosticActionOutcome;
  readonly surface?: "notes" | "events" | "marker" | "editor" | "app";
}

/** A redacted warning or error from the frontend or native host. */
export interface DiagnosticIssueEntry {
  readonly at: number;
  readonly severity: "warning" | "error";
  readonly source: "frontend" | "host" | "backend";
  readonly message: string;
  readonly code?: string;
}

/** Complete bounded interaction payload written to the diagnostic bundle. */
export interface InteractionDiagnosticsSnapshot {
  readonly actions: readonly DiagnosticActionEntry[];
  readonly issues: readonly DiagnosticIssueEntry[];
  readonly droppedActions: number;
  readonly droppedIssues: number;
  readonly capacities: { readonly actions: number; readonly issues: number };
}

const ACTION_CAPACITY = 512;
const ISSUE_CAPACITY = 256;
const actions: DiagnosticActionEntry[] = [];
const issues: DiagnosticIssueEntry[] = [];
let droppedActions = 0;
let droppedIssues = 0;

/** Keep a stable semantic id without preserving arbitrary labels or values. */
function safeActionId(id: string): string {
  const normalized = id.trim().slice(0, 96);
  return /^[a-z0-9._:-]+$/iu.test(normalized) ? normalized : "[redacted]";
}

/** Keep only stable source-owned context on an action entry. */
function safeSurface(surface: string | undefined): DiagnosticActionEntry["surface"] | undefined {
  return surface === "notes" ||
    surface === "events" ||
    surface === "marker" ||
    surface === "editor" ||
    surface === "app"
    ? surface
    : undefined;
}

/** Append an action and retain only the newest bounded window. */
export function recordDiagnosticAction(
  id: string,
  source: DiagnosticActionSource,
  outcome: DiagnosticActionOutcome = "completed",
  surface?: string,
): void {
  actions.push({
    at: Date.now(),
    id: safeActionId(id),
    source,
    outcome,
    ...(safeSurface(surface) ? { surface: safeSurface(surface) } : {}),
  });
  if (actions.length > ACTION_CAPACITY) {
    actions.shift();
    droppedActions += 1;
  }
}

/** Append one redacted warning/error and retain only the newest bounded window. */
export function recordDiagnosticIssue(
  severity: DiagnosticIssueEntry["severity"],
  source: DiagnosticIssueEntry["source"],
  error: unknown,
  code?: string,
): void {
  const message = redactDiagnosticText(
    error instanceof Error ? error.stack || error.message : String(error),
  );
  issues.push({
    at: Date.now(),
    severity,
    source,
    message,
    ...(code && /^[a-z0-9._:-]{1,64}$/iu.test(code) ? { code } : {}),
  });
  if (issues.length > ISSUE_CAPACITY) {
    issues.shift();
    droppedIssues += 1;
  }
}

/** Clear retained records for deterministic tests and a fresh app session. */
export function resetInteractionDiagnostics(): void {
  actions.length = 0;
  issues.length = 0;
  droppedActions = 0;
  droppedIssues = 0;
}

/** Return a detached snapshot that contains no input values or DOM content. */
export function interactionDiagnosticsSnapshot(): InteractionDiagnosticsSnapshot {
  return {
    actions: actions.map((entry) => ({ ...entry })),
    issues: issues.map((entry) => ({ ...entry })),
    droppedActions,
    droppedIssues,
    capacities: { actions: ACTION_CAPACITY, issues: ISSUE_CAPACITY },
  };
}
