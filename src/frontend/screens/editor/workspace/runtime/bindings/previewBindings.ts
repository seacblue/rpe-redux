/**
 * Adapts the preview renderer's frame geometry to the public preview contract.
 *
 * The renderer owns screen-space points but not chart ids or the canvas's
 * placement in the window. This adapter joins those facts, so the public
 * snapshot carries stable object ids and both client and surface coordinates.
 */
import type {
  PreviewApiHost,
  PreviewObject,
  PreviewObjectGeometry,
  PreviewPoint,
  PreviewSnapshot,
} from "../../../../../../core/edit/preview/api.ts";
import { editorRealtimePreviewEnabled } from "../../../../../../core/edit/state/publishedValues.ts";
import type {
  HitTestLineGeometry,
  HitTestNoteGeometry,
  HitTestPreviewGeometry,
} from "../../../../../../core/edit/hitTest/api.ts";
import type {
  PreviewFrameImage,
  PreviewFrameSpec,
} from "../../../../../../core/edit/preview/frame.ts";
import type { Preview } from "../../preview/scene/preview.ts";

/** A point in surface pixels. */
function point(x: number, y: number): PreviewPoint {
  return { x, y };
}

/** The centroid of two opposite corners. */
function midpoint(left: PreviewPoint, right: PreviewPoint): PreviewPoint {
  return point((left.x + right.x) / 2, (left.y + right.y) / 2);
}

/** Visible length of a note along its local Y axis. */
function noteHeight(note: HitTestNoteGeometry): number {
  if (note.kind === "hold") {
    return Math.hypot(note.tail.x - note.head.x, note.tail.y - note.head.y);
  }
  return note.height ?? note.width;
}

/** Rotated rectangle corners around the note center, starting at local top-left. */
function noteCorners(
  note: HitTestNoteGeometry,
  center: PreviewPoint,
  height: number,
): readonly PreviewPoint[] {
  const angle = (note.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const halfWidth = note.width / 2;
  const halfHeight = height / 2;
  // Local X is the note width and local Y is its length; both rotate with the
  // judge line. Corner order starts at the local top-left.
  const widthX = cosine * halfWidth;
  const widthY = sine * halfWidth;
  const heightX = -sine * halfHeight;
  const heightY = cosine * halfHeight;
  return [
    point(center.x - widthX - heightX, center.y - widthY - heightY),
    point(center.x + widthX - heightX, center.y + widthY - heightY),
    point(center.x + widthX + heightX, center.y + widthY + heightY),
    point(center.x - widthX + heightX, center.y - widthY + heightY),
  ];
}

/** Converts one hit-test note into the public object geometry. */
function noteGeometry(note: HitTestNoteGeometry): PreviewObjectGeometry {
  const center = midpoint(note.head, note.tail);
  return {
    center,
    head: point(note.head.x, note.head.y),
    tail: point(note.tail.x, note.tail.y),
    corners: noteCorners(note, center, noteHeight(note)),
  };
}

/** Converts one judge-line rectangle into the public object geometry. */
function lineGeometry(line: HitTestLineGeometry): PreviewObjectGeometry {
  const center = point(line.center.x, line.center.y);
  return {
    center,
    head: center,
    tail: center,
    corners: line.corners.map((corner) => point(corner.x, corner.y)),
  };
}

/** Moves surface geometry into client coordinates. */
function shifted(
  geometry: PreviewObjectGeometry,
  left: number,
  top: number,
): PreviewObjectGeometry {
  const shift = (value: PreviewPoint): PreviewPoint => point(value.x + left, value.y + top);
  return {
    center: shift(geometry.center),
    head: shift(geometry.head),
    tail: shift(geometry.tail),
    corners: geometry.corners.map(shift),
  };
}

/** Joins stable chart ids with the renderer's geometry for one snapshot. */
function buildSnapshot(preview: Preview, geometry: HitTestPreviewGeometry): PreviewSnapshot | null {
  const chart = preview.chart;
  if (!chart) {
    return null;
  }
  const bounds = preview.canvas.getBoundingClientRect();
  const lines = chart.judgeLineList ?? [];
  const objects: PreviewObject[] = [];
  for (const line of geometry.lines) {
    const surface = lineGeometry(line);
    objects.push({
      id: lines[line.lineIndex]?.id ?? `line:${line.lineIndex}`,
      kind: "judgeLine",
      lineIndex: line.lineIndex,
      client: shifted(surface, bounds.left, bounds.top),
      surface,
      width: line.width,
      height: line.height,
      rotation: line.rotation,
      radius: 0,
    });
  }
  for (const note of geometry.notes) {
    const surface = noteGeometry(note);
    const chartNote =
      note.noteIndex >= 0 ? lines[note.lineIndex]?.notes?.[note.noteIndex] : undefined;
    const fallbackId = `line:${note.lineIndex}:note:${note.noteIndex}`;
    objects.push({
      id: chartNote?.id || fallbackId,
      kind: note.kind,
      lineIndex: note.lineIndex,
      noteIndex: note.noteIndex >= 0 ? note.noteIndex : undefined,
      client: shifted(surface, bounds.left, bounds.top),
      surface,
      width: note.width,
      height: noteHeight(note),
      rotation: note.rotation,
      radius: note.radius,
      ...(chartNote
        ? {
            debug: Object.freeze({
              startTime: Object.freeze([...chartNote.startTime]),
              endTime: Object.freeze([...chartNote.endTime]),
              positionX: chartNote.positionX,
              type: chartNote.type,
              above: chartNote.above,
              speed: chartNote.speed,
              size: chartNote.size,
              isFake: chartNote.isFake,
              yOffset: chartNote.yOffset,
            }),
          }
        : {}),
    });
  }
  return {
    revision: geometry.revision,
    seconds: geometry.seconds,
    bounds: {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
    viewport: { ...geometry.viewport },
    width: geometry.width,
    height: geometry.height,
    scale: geometry.scale,
    scaleX: geometry.scaleX,
    scaleY: geometry.scaleY,
    devicePixelRatio: geometry.devicePixelRatio,
    objects,
  };
}

/** Creates the host behind `redux.preview` for one mounted preview renderer. */
export function createPreviewApiHost({
  preview,
  captureFrame,
}: {
  preview: Preview;
  captureFrame: (request: PreviewFrameSpec) => Promise<PreviewFrameImage>;
}): PreviewApiHost {
  return {
    snapshot() {
      if (!editorRealtimePreviewEnabled.get()) {
        return null;
      }
      const geometry = preview.getCollisionGeometry();
      return geometry ? buildSnapshot(preview, geometry) : null;
    },
    subscribe(listener) {
      const stopGeometry = preview.observeGeometry((geometry) => {
        if (!geometry || !editorRealtimePreviewEnabled.get()) {
          listener(null);
          return;
        }
        listener(buildSnapshot(preview, geometry));
      });
      const stopVisibility = editorRealtimePreviewEnabled.subscribe(() => {
        if (!editorRealtimePreviewEnabled.get()) {
          listener(null);
          return;
        }
        const geometry = preview.getCollisionGeometry();
        listener(geometry ? buildSnapshot(preview, geometry) : null);
      });
      return () => {
        stopGeometry();
        stopVisibility();
      };
    },
    frame(request) {
      return captureFrame(request);
    },
  };
}
