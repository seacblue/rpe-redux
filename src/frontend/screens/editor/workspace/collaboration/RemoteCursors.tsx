/**
 * Remote member cursors over the timeline.
 *
 * Positions are recomputed from the live viewport on a short timer because
 * scrolling and zooming change the mapping without changing chart revision.
 * Presence is ephemeral and never enters the document history. Notes use the
 * line and chart position they report; the events field uses the beat and the
 * pointer's horizontal ratio.
 */
import { useEffect, useState } from "react";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { useCollaboration } from "./collaborationRuntime.tsx";

/** Draws other members' timeline cursors from the current presence snapshot. */
export function RemoteCursors() {
  const runtime = useEditorRuntime();
  const { state } = useCollaboration();
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!state.roomId || state.presence.length === 0) {
      return;
    }
    // Presence timestamps are wall-clock values; a short timer expires stale
    // entries even when no other state changes.
    const timer = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, [state.roomId, state.presence.length]);

  if (!runtime || !state.roomId) {
    return null;
  }
  const session = runtime.getSession();
  const viewport = runtime.timeline.viewport;
  const notesCanvas = runtime.timeline.notesCanvas;
  const eventsCanvas = runtime.timeline.eventsCanvas;
  const markers = state.presence.flatMap((presence) => {
    if (
      presence.memberId === state.memberId ||
      presence.area !== "edit" ||
      presence.timeline === false ||
      presence.beat === undefined ||
      (now > 0 && now - presence.updatedAt > 5000)
    ) {
      return [];
    }
    const member = state.members.find((candidate) => candidate.id === presence.memberId);
    if (!member) {
      return [];
    }
    const area = presence.timelineArea ?? "notes";
    const canvas = area === "events" ? eventsCanvas : notesCanvas;
    const bounds = canvas.getBoundingClientRect();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (bounds.width <= 0 || bounds.height <= 0 || width <= 0 || height <= 0) {
      return [];
    }
    let x: number | undefined;
    let y: number | undefined;
    if (area === "notes" && presence.lineId && presence.positionX !== undefined) {
      const lineIndex =
        session.chart.judgeLineList?.findIndex((line) => line.id === presence.lineId) ?? -1;
      if (lineIndex >= 0) {
        x = viewport.noteHorizontal(presence.positionX, lineIndex);
        y = viewport.verticalForLine(presence.beat, lineIndex, viewport.viewHeight(), "notes");
      }
    }
    if (x === undefined || y === undefined) {
      if (presence.cursorRatio === undefined) {
        return [];
      }
      x = Math.min(1, Math.max(0, presence.cursorRatio)) * width;
      y =
        area === "events"
          ? viewport.eventVertical(presence.beat, "moveX")
          : viewport.vertical(presence.beat, height);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > width || y > height) {
      return [];
    }
    return [
      {
        id: presence.memberId,
        area,
        name: member.profile.name,
        color: member.profile.color,
        left: bounds.left + (x * bounds.width) / width,
        top: bounds.top + (y * bounds.height) / height,
      },
    ];
  });
  if (markers.length === 0) {
    return null;
  }
  return (
    <div className="collab-cursors" aria-hidden="true">
      {markers.map((marker) => (
        <div
          key={marker.id}
          className={`collab-cursor is-${marker.area}`}
          style={{ left: marker.left, top: marker.top, color: marker.color }}
        >
          <span className="collab-cursor-dot" />
          <span className="collab-cursor-name">{marker.name}</span>
        </div>
      ))}
    </div>
  );
}
