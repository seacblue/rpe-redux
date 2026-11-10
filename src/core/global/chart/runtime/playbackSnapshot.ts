/**
 * Builds the headless playback snapshot extensions read through the public API.
 *
 * Every authored line and note keeps its stable index and sampled state, plus
 * world-space head and tail positions, including notes currently culled from the
 * preview.
 */
import type { SceneAdapter } from "./sceneAdapter.ts";
import type { Chart } from "../chart.ts";
import type { TempoSource } from "../timing/events.ts";
import type { LineState, NoteState } from "./scene.ts";

/** World coordinates use RPE's positive-up Y, unlike canvas's positive-down Y. */
function noteWorld(state: LineState, note: Pick<NoteState, "x" | "y">) {
  const angle = (state.rotation * Math.PI) / 180;
  return {
    x: state.x + note.x * Math.cos(angle) + note.y * Math.sin(angle),
    y: state.y - note.x * Math.sin(angle) + note.y * Math.cos(angle),
  };
}

/** All authored objects, stable line/note indices, including currently culled notes. */
export function playbackSnapshot(
  scene: SceneAdapter,
  chart: Chart,
  tempo: TempoSource,
  seconds: number,
) {
  if (!Number.isFinite(seconds)) {
    throw new RangeError("seconds must be finite");
  }
  scene.compile(chart, tempo);
  const sample = scene.sampler(seconds);
  return {
    seconds,
    lines: scene.lines.flatMap((runtime, lineIndex) => {
      if (!runtime) {
        return [];
      }
      const state = sample(lineIndex);
      const visible = new Set(
        runtime.visibleNotes(seconds, state, 1600 + Math.hypot(state.x, state.y)),
      );
      return [
        {
          lineIndex,
          state,
          texture: runtime.line.Texture ?? "line.png",
          notes: runtime.notes.map((entry, noteIndex) => {
            const local = runtime.noteState(entry, state, seconds);
            const head = noteWorld(state, local);
            const tail = noteWorld(state, { x: local.x, y: local.tail });
            return {
              lineIndex,
              noteIndex,
              type: entry.note.type,
              startSeconds: entry.start,
              endSeconds: entry.end,
              floor: entry.floor,
              tailFloor: entry.tail,
              distance: entry.floor - state.floor,
              local,
              head,
              tail,
              visible: visible.has(entry) && local.alpha > 0 && local.size !== 0,
            };
          }),
        },
      ];
    }),
  };
}
