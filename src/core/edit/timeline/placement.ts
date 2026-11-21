/**
 * Turning a click into chart content: the one module among the timeline's input
 * helpers that writes to the session.
 *
 * It reads no viewport and no snap geometry — the caller has already turned the
 * pointer into a beat and a position — so a placement can be reasoned about (and
 * tested) without a canvas, and the hit-testing and preview modules stay pure.
 * The two-click hold lives here too, because "a half-placed hold" is session
 * input state rather than a drawing concern.
 */

import { beatValue, maxBeat, minBeat, toBeat, type Beat } from "../../global/chart/timing/beat.ts";
import type { EditorSession } from "../session/session.ts";
import type { PendingHold } from "./types.ts";
import { placeNoteAtBeatTarget } from "./noteCommands.ts";

/**
 * Places an instant note or starts/finishes a two-click hold at the target.
 *
 * A beat triple reaches `createNote` unchanged so a grid placement keeps its
 * exact denominator; a plain number is quantized over the default resolution.
 * Returns the pending hold state after the click.
 */
export function placeTimelineNote(
  session: EditorSession,
  type: number,
  beat: number | Beat,
  positionX: number,
  lineIndex: number,
  pending: PendingHold | null,
): PendingHold | null {
  session.focus = "notes";
  session.eventSelection.clear();
  const nextBeat = toBeat(beat);
  if (!Number.isFinite(positionX)) {
    return pending;
  }
  if (type !== 2) {
    placeNoteAtBeatTarget(session, type as 1 | 2 | 3 | 4, {
      lineIndex,
      from: { beat: nextBeat, positionX },
    });
    return pending;
  }
  if (!pending) {
    return { beat: nextBeat, positionX, lineIndex };
  }
  const startBeat = minBeat(pending.beat, nextBeat);
  const endBeat = maxBeat(pending.beat, nextBeat);
  if (beatValue(endBeat) - beatValue(startBeat) >= 0.001 && Number.isFinite(pending.positionX)) {
    // A Hold has one chart X coordinate. The second click supplies its end
    // time; the visual tail is independent of the head's X coordinate.
    placeNoteAtBeatTarget(session, 2, {
      lineIndex: pending.lineIndex,
      from: { beat: startBeat, positionX: pending.positionX },
      to: { beat: endBeat, positionX: pending.positionX },
    });
  }
  return null;
}
