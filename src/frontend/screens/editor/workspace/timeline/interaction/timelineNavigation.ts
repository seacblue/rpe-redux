/**
 * Binds timeline wheel input to playback seeking, line stepping, and vertical
 * zoom.
 *
 * Direction, line-stepping, and zoom are rebindable shortcuts; this module only
 * owns the wheel arithmetic and delegates the matched action. Transport and
 * line-step rules stay in core.
 */
import { wheelStepBeats } from "../../../../../../core/global/chart/editing/editGrid.ts";
import { matchTimelineWheel } from "../../../../../../core/edit/shortcuts/timelineWheel.ts";
import type { EditorSession } from "../../../../../../core/edit/session/session.ts";
import type { LineSwitcher } from "../lineSwitcher/lineSwitcher.ts";
import type { TimelineGestures } from "./timelineGestures.ts";
import type { TimelineViewport } from "../viewport/timelineViewport.ts";

/** Preferences that shape an ordinary wheel notch; Shift always means one beat. */
export interface TimelineWheelSettings {
  readonly scrollSpeed: number;
  readonly scrollAcceleration: boolean;
}

interface TimelineNavigationDependencies {
  timeline: {
    gestures: Pick<TimelineGestures, "onWheel">;
    viewport: Pick<TimelineViewport, "division" | "minimumScrollSeconds">;
  };
  session: () => EditorSession;
  /** Moves by a beat delta; a running transport keeps playing, a paused one glides. */
  seekByBeats(deltaBeats: number, minimumSeconds: number): void;
  wheelSettings: () => TimelineWheelSettings;
  lineSwitcher: Pick<LineSwitcher, "step">;
  /** Returns true when the event changed timeline state and needs a repaint. */
  zoomVertical?: (event: WheelEvent, direction: -1 | 1) => boolean;
}

/** A detent-sized pixel delta counts as one notch even when a device reports 37. */
const WHEEL_MIN_DETENT_PIXELS = 32;
/** Reference distance of one conventional notch; larger events may contain several. */
const WHEEL_NOTCH_PIXELS = 100;
/** Trackpad deltas below the detent threshold accumulate into one notch. */
const WHEEL_MIN_TRACKPAD_PIXELS = 24;
/** Emit a partial trackpad gesture once the stream pauses for this long. */
const WHEEL_TRACKPAD_FLUSH_MS = 30;
/** Drop a partial trackpad gesture once the user has stopped scrolling. */
const WHEEL_ACCUMULATOR_RESET_SECONDS = 0.25;

/** Connect timeline wheel input to chart navigation and playback seeking. */
export function bindTimelineNavigation({
  timeline,
  session,
  seekByBeats,
  wheelSettings,
  lineSwitcher,
  zoomVertical,
}: TimelineNavigationDependencies): {
  wheel(event: WheelEvent): boolean;
} {
  let lastWheel = -Infinity;
  let lastNotchAt = -Infinity;
  let burstStart = 0;
  let trackpadDistance = 0;
  let trackpadDirection: -1 | 1 = 1;
  let trackpadShift = false;
  let trackpadTimer: ReturnType<typeof setTimeout> | null = null;

  /** Forget the accumulated trackpad distance and its flush timer. */
  const resetTrackpad = () => {
    trackpadDistance = 0;
    if (trackpadTimer !== null) {
      clearTimeout(trackpadTimer);
      trackpadTimer = null;
    }
  };

  /**
   * Apply a whole number of notches in one time direction.
   *
   * The step is a grid division per notch; the pixel distance only decides how
   * many notches one event represents. Keeping those two concerns apart is what
   * makes a 37 px detent, a 100 px detent and a smooth-scrolled 120 px gesture
   * all move by the same amount.
   */
  const emitWheel = (direction: -1 | 1, notches: number, shiftKey: boolean) => {
    if (!notches) {
      return;
    }
    const settings = wheelSettings();
    const now = performance.now() / 1000;
    if (now - lastWheel > 0.2) {
      burstStart = now;
    }
    lastWheel = now;
    const division = timeline.viewport.division > 0 ? timeline.viewport.division : 4;
    // Shift is a whole beat regardless of the grid, so it bypasses the speed and
    // acceleration preferences. The action binding decides the direction.
    const stepBeats = shiftKey
      ? 1
      : wheelStepBeats(
          division,
          settings.scrollSpeed,
          settings.scrollAcceleration,
          now - burstStart,
        );
    const minimum =
      timeline.viewport.minimumScrollSeconds() + Number(session().chart.META.offset ?? 0) / 1000;
    seekByBeats(direction * notches * stepBeats, minimum);
  };

  /** Emit the tail of a sub-detent trackpad gesture as one final notch. */
  const flushTrackpad = () => {
    trackpadTimer = null;
    const distance = trackpadDistance;
    trackpadDistance = 0;
    if (Math.abs(distance) < WHEEL_MIN_TRACKPAD_PIXELS) {
      return;
    }
    emitWheel(trackpadDirection, 1, trackpadShift);
  };

  /** Route a wheel event to zoom, line stepping, or smooth seeking. */
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const action = matchTimelineWheel(event);
    if (action?.kind === "zoom") {
      resetTrackpad();
      return zoomVertical?.(event, action.direction) ?? false;
    }
    if (action?.kind === "line") {
      resetTrackpad();
      if (event.deltaY) {
        lineSwitcher.step(action.direction);
        return true;
      }
      return false;
    }
    if (action?.kind !== "seek" || !event.deltaY) {
      resetTrackpad();
      return false;
    }
    const direction = action.direction;
    const now = performance.now() / 1000;
    if (now - lastNotchAt > WHEEL_ACCUMULATOR_RESET_SECONDS) {
      trackpadDistance = 0;
    }
    lastNotchAt = now;
    if (event.deltaMode !== 0) {
      // Line/page deltas are already discrete.
      resetTrackpad();
      emitWheel(direction, 1, event.shiftKey);
      return true;
    }
    const magnitude = Math.abs(event.deltaY);
    if (magnitude >= WHEEL_MIN_DETENT_PIXELS) {
      // Coalesced events can carry several notches; a single mouse detent that
      // reports 37–120 px still counts once because of the minimum.
      resetTrackpad();
      emitWheel(direction, Math.max(1, Math.round(magnitude / WHEEL_NOTCH_PIXELS)), event.shiftKey);
      return true;
    }
    if (direction !== trackpadDirection) {
      trackpadDistance = 0;
    }
    trackpadDirection = direction;
    trackpadShift = event.shiftKey;
    trackpadDistance += magnitude;
    const whole = Math.trunc(trackpadDistance / WHEEL_NOTCH_PIXELS);
    if (whole) {
      trackpadDistance -= whole * WHEEL_NOTCH_PIXELS;
      emitWheel(direction, whole, event.shiftKey);
    }
    if (trackpadTimer !== null) {
      clearTimeout(trackpadTimer);
    }
    trackpadTimer = setTimeout(flushTrackpad, WHEEL_TRACKPAD_FLUSH_MS);
    return false;
  };
  timeline.gestures.onWheel = wheel;

  return { wheel };
}
