/**
 * Projects chart-independent settings values onto runtime owners.
 *
 * The session, its event wheel steps and hitsound compilation read their policy
 * here. Changing hitsound offsets clears the compiled sounds because the
 * compiled buffer is keyed on those offsets.
 */
import type { HitSounds } from "../../media/hitsounds.ts";
import type { HitSoundOffsetMap } from "../../media/hitTimeline.ts";
import type { EditorSession } from "../session/session.ts";
import { values } from "../../state/values.ts";
import "../../settings/editorRuntime.ts";
import "../../settings/features/index.ts";
import { EVENT_STEP_SETTINGS } from "../../settings/stepperSettings.ts";

const hitSoundLimitEnabled = values.getHandle<boolean>("hitsound-limit-enabled");
const hitSoundLimit = values.getHandle<string | undefined>("hitsound-limit");

/** True when both offset maps agree on every hitsound kind. */
function sameOffsets(left: HitSoundOffsetMap, right: HitSoundOffsetMap): boolean {
  return ["tap", "drag", "flick", "custom"].every(
    (kind) => left[kind as keyof HitSoundOffsetMap] === right[kind as keyof HitSoundOffsetMap],
  );
}

/** Reads hitsound offsets in seconds from the persisted millisecond settings. */
function soundOffsets(): HitSoundOffsetMap {
  return Object.fromEntries(
    ["tap", "drag", "flick", "custom"].map((kind) => [
      kind,
      Number(values.byId.get<string | undefined>(`hitsound-offset-${kind}`) ?? 0) / 1000,
    ]),
  );
}

/** Applies chart-independent settings values to runtime owners. */
export function applySessionRuntimeSettings(
  session: EditorSession,
  hitSounds: Pick<HitSounds, "soundPolicy" | "offsets" | "compiled">,
): void {
  hitSounds.soundPolicy.enabled = hitSoundLimitEnabled.get();
  hitSounds.soundPolicy.limit = Number(hitSoundLimit.get() ?? 5);
  const offsets = soundOffsets();
  if (!sameOffsets(offsets, hitSounds.offsets)) {
    hitSounds.offsets = offsets;
    hitSounds.compiled = null;
  }
  session.eventWheelSteps = Object.fromEntries(
    Object.entries(EVENT_STEP_SETTINGS).flatMap(([eventType, key]) => {
      const step = Number(values.byId.get<string | undefined>(key));
      return Number.isFinite(step) && step > 0 ? [[eventType, step]] : [];
    }),
  );
}
