/**
 * Other members' playhead ticks inside the lower part of the progress bar.
 *
 * Presence publishes `playheadBeat`; this layer maps it through the chart tempo
 * to the scrubber's audio position. The name stays hidden until the pointer
 * approaches the tick.
 */
import { useEffect, useState } from "react";
import { useTransportSurface } from "../../../../chrome/transport/TransportDomSurface.tsx";
import { useEditorRuntime } from "../runtime/composition/EditorRuntime.tsx";
import { useCollaboration } from "./collaborationRuntime.tsx";
import { buildRemotePlayheads } from "./remotePlayheads.ts";

/** Draws remote playhead markers below the local marker ticks. */
export function RemotePlayheads() {
  const runtime = useEditorRuntime();
  const transport = useTransportSurface();
  const { state } = useCollaboration();
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!state.roomId || state.presence.length === 0) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, [state.roomId, state.presence.length]);

  if (!runtime || !state.roomId) {
    return null;
  }
  const scrubber = transport.refs.scrubber.current;
  const bounds = scrubber?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }
  const tempo = runtime.providers.session.tempo.get();
  const duration = runtime.audio.buffer?.duration ?? 0;
  if (!tempo || duration <= 0) {
    return null;
  }
  const session = runtime.getSession();
  const offset = Number(session.chart.META.offset ?? 0) / 1000;
  const playheads = buildRemotePlayheads({
    presence: state.presence,
    members: state.members,
    selfId: state.memberId,
    now,
    tempo,
    offsetSeconds: offset,
    duration,
  });
  if (playheads.length === 0) {
    return null;
  }
  return (
    <div className="collab-playheads" aria-hidden="true">
      {playheads.map((playhead) => (
        <div
          key={playhead.id}
          className="collab-playhead"
          style={{
            left: bounds.left + playhead.ratio * bounds.width,
            top: bounds.bottom - 16,
            color: playhead.color,
          }}
        >
          <span className="collab-playhead-bar" />
          <span className="collab-playhead-name">{playhead.name}</span>
        </div>
      ))}
    </div>
  );
}
