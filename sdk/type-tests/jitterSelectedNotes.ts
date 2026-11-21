/**
 * Compile-time check for the "jitter selected notes" script.
 *
 * This is the smallest useful chart-edit tool: read the selection, read each
 * note by its stable id, and commit one id-addressed transaction. `check:sdk`
 * keeps the example honest when handle names or result fields change.
 */
import type { ExtensionScriptContext, ExtensionScriptDefinition } from "@rpe-redux/extension-sdk";

/** RPE note positions use the judge line's half-width. */
const POSITION_X_LIMIT = 675;

/** Small deterministic LCG so a recorded seed reproduces the same jitter. */
function seededRandom(seed: number): () => number {
  let state = (Number.isSafeInteger(seed) ? seed : 1) >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** A data-only friendly script definition with a synchronous JS run body. */
const definition: ExtensionScriptDefinition = {
  id: "jitter-selected-x",
  label: "Jitter selected X",
  description: "Move every selected note by a seeded random offset.",
  parameters: {
    parameters: {
      amount: { kind: "number", label: "Max offset", default: 20, min: 0, step: 1 },
      seed: { kind: "number", label: "Seed", default: 1, step: 1 },
    },
  },
  async run({ api, params, ui }: ExtensionScriptContext) {
    const selection = await api.selection.state();
    if (!selection.ok) {
      ui.notice(selection.error.message ?? "Selection is unavailable.", { level: "warning" });
      return;
    }
    if (selection.value.notes.length === 0) {
      ui.notice("Select at least one note.", { level: "warning" });
      return;
    }

    const amount = Math.max(0, Number(params.amount ?? 20));
    const random = seededRandom(Number(params.seed ?? 1));
    const updates = [];
    for (const ref of selection.value.notes) {
      const read = await api.chart.note(ref.id);
      if (!read.ok || !read.value) {
        continue;
      }
      const current = read.value.note.positionX ?? 0;
      const next = Math.max(
        -POSITION_X_LIMIT,
        Math.min(POSITION_X_LIMIT, current + (random() * 2 - 1) * amount),
      );
      updates.push({ id: ref.id, patch: { positionX: next } });
    }
    if (updates.length === 0) {
      ui.notice("No readable notes in the selection.", { level: "warning" });
      return;
    }

    const applied = await api.transaction.apply({
      label: "Jitter selected notes",
      notes: { update: updates },
    });
    if (!applied.ok) {
      ui.notice(applied.error.message ?? "The edit failed.", { level: "error" });
      return;
    }
    if (applied.value.status === "unchanged") {
      ui.notice("The selection is already at its target position.", { level: "info" });
      return;
    }
    if (applied.value.status !== "committed") {
      const issue = applied.value.issues[0]?.message ?? applied.value.status;
      ui.notice(`The edit was not committed: ${issue}`, { level: "error" });
      return;
    }
    ui.notice(`Jittered ${updates.length} note(s).`, { level: "success" });
  },
};

void definition;
