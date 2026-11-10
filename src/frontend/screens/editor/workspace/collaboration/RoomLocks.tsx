/** Readable lock rows with owner, object name, and lease countdown. */
import { useSyncExternalStore } from "react";
import type { Chart } from "../../../../../core/global/chart/chart.ts";
import type { RoomLock, RoomMember } from "../../../../../core/collaboration/types.ts";
import { useTranslation, type Translator } from "../../../../../i18n/react.ts";

/** Subscribe to one clock tick per second for lease countdowns. */
function subscribeSecond(callback: () => void): () => void {
  const timer = window.setInterval(callback, 1000);
  return () => window.clearInterval(timer);
}

/** Stable wall-clock milliseconds rounded down to the current second. */
function currentSecond(): number {
  return Math.floor(Date.now() / 1000) * 1000;
}

/** Countdown for one cooperative lock's lease. */
function LockExpiry({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation();
  const now = useSyncExternalStore(subscribeSecond, currentSecond, currentSecond);
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return (
    <small className="collab-member-role">
      {seconds > 0
        ? t("workspace.collaboration.lockReleases", { seconds })
        : t("workspace.collaboration.lockExpired")}
    </small>
  );
}

/** Turns one lock scope into the object name a person recognizes. */
function lockLabel(lock: RoomLock, chart: Chart | undefined, t: Translator["t"]) {
  if (lock.id === "chart") {
    return t("workspace.collaboration.lockObject.chart");
  }
  if (lock.id.startsWith("line:")) {
    const id = lock.id.slice(5);
    const name = chart?.judgeLineList?.find((line) => line.id === id)?.Name ?? id;
    return t("workspace.collaboration.lockObject.line", { name });
  }
  if (lock.id.startsWith("obj:")) {
    return t("workspace.collaboration.lockObject.note", { name: lock.id.slice(4) });
  }
  return lock.id;
}

/** Lists live edit locks with the member and object they block. */
export function RoomLocks({
  locks,
  members,
  chart,
}: {
  readonly locks: readonly RoomLock[];
  readonly members: readonly RoomMember[];
  readonly chart: Chart | undefined;
}) {
  const { t } = useTranslation();
  return (
    <ul className="collab-member-list">
      {locks.map((lock) => (
        <li key={lock.id} className="collab-member">
          <span className="collab-member-name">{lockLabel(lock, chart, t)}</span>
          <small className="collab-member-role">
            {members.find((member) => member.id === lock.ownerId)?.profile.name ?? lock.ownerId}
          </small>
          <LockExpiry expiresAt={lock.expiresAt} />
        </li>
      ))}
    </ul>
  );
}
