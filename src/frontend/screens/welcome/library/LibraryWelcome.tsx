/**
 * Borderless welcome panel for the home library's detail column.
 *
 * It fills the column while no chart is selected: a time-of-day greeting and
 * invitation, the library's running totals, and a local-day check-in that
 * reveals a Luogu-style daily fortune. The fortune pairs each item with a
 * suitable and an avoid note, so the reading keeps the community tone instead
 * of a generic horoscope. The check-in is a small ritual, not an account
 * feature; the day lives in localStorage and the fortune is seeded from it.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { Spinner } from "../../../../design/components/spinner/Spinner.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import type { LibraryEntry } from "./libraryEntries.ts";
import { formatChartingTime, formatCount } from "./libraryFormat.ts";
import {
  dailyFortunePicks,
  fortuneIndexForDay,
  localDay,
  readCheckInDay,
  writeCheckInDay,
} from "./welcomeCheckIn.ts";

/** Fortune ranks from best to worst; the daily draw uses the same order. */
const FORTUNE_RANKS = [
  {
    id: "great",
    label: "workspace.welcome.library.fortune.rank.great",
    tone: "good",
  },
  {
    id: "good",
    label: "workspace.welcome.library.fortune.rank.good",
    tone: "good",
  },
  {
    id: "small",
    label: "workspace.welcome.library.fortune.rank.small",
    tone: "good",
  },
  {
    id: "fair",
    label: "workspace.welcome.library.fortune.rank.fair",
    tone: "neutral",
  },
  {
    id: "bad",
    label: "workspace.welcome.library.fortune.rank.bad",
    tone: "bad",
  },
  {
    id: "dire",
    label: "workspace.welcome.library.fortune.rank.dire",
    tone: "worst",
  },
] as const;

/**
 * Shared fortune items. Each item carries one suitable and one avoid note, so
 * the same action can read as a good idea or a warning depending on the side.
 */
const FORTUNE_ITEMS = [
  {
    label: "workspace.welcome.library.fortune.item.stayUp",
    suitable: "workspace.welcome.library.fortune.item.stayUp.suitable",
    avoid: "workspace.welcome.library.fortune.item.stayUp.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.sleep",
    suitable: "workspace.welcome.library.fortune.item.sleep.suitable",
    avoid: "workspace.welcome.library.fortune.item.sleep.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.eat",
    suitable: "workspace.welcome.library.fortune.item.eat.suitable",
    avoid: "workspace.welcome.library.fortune.item.eat.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.takeout",
    suitable: "workspace.welcome.library.fortune.item.takeout.suitable",
    avoid: "workspace.welcome.library.fortune.item.takeout.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.canteen",
    suitable: "workspace.welcome.library.fortune.item.canteen.suitable",
    avoid: "workspace.welcome.library.fortune.item.canteen.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.milkTea",
    suitable: "workspace.welcome.library.fortune.item.milkTea.suitable",
    avoid: "workspace.welcome.library.fortune.item.milkTea.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.coffee",
    suitable: "workspace.welcome.library.fortune.item.coffee.suitable",
    avoid: "workspace.welcome.library.fortune.item.coffee.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.slack",
    suitable: "workspace.welcome.library.fortune.item.slack.suitable",
    avoid: "workspace.welcome.library.fortune.item.slack.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.bilibili",
    suitable: "workspace.welcome.library.fortune.item.bilibili.suitable",
    avoid: "workspace.welcome.library.fortune.item.bilibili.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.moments",
    suitable: "workspace.welcome.library.fortune.item.moments.suitable",
    avoid: "workspace.welcome.library.fortune.item.moments.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.actHumble",
    suitable: "workspace.welcome.library.fortune.item.actHumble.suitable",
    avoid: "workspace.welcome.library.fortune.item.actHumble.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.actPro",
    suitable: "workspace.welcome.library.fortune.item.actPro.suitable",
    avoid: "workspace.welcome.library.fortune.item.actPro.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.worship",
    suitable: "workspace.welcome.library.fortune.item.worship.suitable",
    avoid: "workspace.welcome.library.fortune.item.worship.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.copyHomework",
    suitable: "workspace.welcome.library.fortune.item.copyHomework.suitable",
    avoid: "workspace.welcome.library.fortune.item.copyHomework.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.homework",
    suitable: "workspace.welcome.library.fortune.item.homework.suitable",
    avoid: "workspace.welcome.library.fortune.item.homework.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.exam",
    suitable: "workspace.welcome.library.fortune.item.exam.suitable",
    avoid: "workspace.welcome.library.fortune.item.exam.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.class",
    suitable: "workspace.welcome.library.fortune.item.class.suitable",
    avoid: "workspace.welcome.library.fortune.item.class.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.computer",
    suitable: "workspace.welcome.library.fortune.item.computer.suitable",
    avoid: "workspace.welcome.library.fortune.item.computer.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.backup",
    suitable: "workspace.welcome.library.fortune.item.backup.suitable",
    avoid: "workspace.welcome.library.fortune.item.backup.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.delete",
    suitable: "workspace.welcome.library.fortune.item.delete.suitable",
    avoid: "workspace.welcome.library.fortune.item.delete.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.chorus",
    suitable: "workspace.welcome.library.fortune.item.chorus.suitable",
    avoid: "workspace.welcome.library.fortune.item.chorus.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.intro",
    suitable: "workspace.welcome.library.fortune.item.intro.suitable",
    avoid: "workspace.welcome.library.fortune.item.intro.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.finale",
    suitable: "workspace.welcome.library.fortune.item.finale.suitable",
    avoid: "workspace.welcome.library.fortune.item.finale.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.sync",
    suitable: "workspace.welcome.library.fortune.item.sync.suitable",
    avoid: "workspace.welcome.library.fortune.item.sync.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.bpm",
    suitable: "workspace.welcome.library.fortune.item.bpm.suitable",
    avoid: "workspace.welcome.library.fortune.item.bpm.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.judgeLine",
    suitable: "workspace.welcome.library.fortune.item.judgeLine.suitable",
    avoid: "workspace.welcome.library.fortune.item.judgeLine.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.cover",
    suitable: "workspace.welcome.library.fortune.item.cover.suitable",
    avoid: "workspace.welcome.library.fortune.item.cover.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.testPlay",
    suitable: "workspace.welcome.library.fortune.item.testPlay.suitable",
    avoid: "workspace.welcome.library.fortune.item.testPlay.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.rhythmGame",
    suitable: "workspace.welcome.library.fortune.item.rhythmGame.suitable",
    avoid: "workspace.welcome.library.fortune.item.rhythmGame.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.stream",
    suitable: "workspace.welcome.library.fortune.item.stream.suitable",
    avoid: "workspace.welcome.library.fortune.item.stream.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.videos",
    suitable: "workspace.welcome.library.fortune.item.videos.suitable",
    avoid: "workspace.welcome.library.fortune.item.videos.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.games",
    suitable: "workspace.welcome.library.fortune.item.games.suitable",
    avoid: "workspace.welcome.library.fortune.item.games.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.shopping",
    suitable: "workspace.welcome.library.fortune.item.shopping.suitable",
    avoid: "workspace.welcome.library.fortune.item.shopping.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.gacha",
    suitable: "workspace.welcome.library.fortune.item.gacha.suitable",
    avoid: "workspace.welcome.library.fortune.item.gacha.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.shower",
    suitable: "workspace.welcome.library.fortune.item.shower.suitable",
    avoid: "workspace.welcome.library.fortune.item.shower.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.goOut",
    suitable: "workspace.welcome.library.fortune.item.goOut.suitable",
    avoid: "workspace.welcome.library.fortune.item.goOut.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.exercise",
    suitable: "workspace.welcome.library.fortune.item.exercise.suitable",
    avoid: "workspace.welcome.library.fortune.item.exercise.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.sun",
    suitable: "workspace.welcome.library.fortune.item.sun.suitable",
    avoid: "workspace.welcome.library.fortune.item.sun.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.desk",
    suitable: "workspace.welcome.library.fortune.item.desk.suitable",
    avoid: "workspace.welcome.library.fortune.item.desk.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.todo",
    suitable: "workspace.welcome.library.fortune.item.todo.suitable",
    avoid: "workspace.welcome.library.fortune.item.todo.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.ask",
    suitable: "workspace.welcome.library.fortune.item.ask.suitable",
    avoid: "workspace.welcome.library.fortune.item.ask.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.comments",
    suitable: "workspace.welcome.library.fortune.item.comments.suitable",
    avoid: "workspace.welcome.library.fortune.item.comments.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.vent",
    suitable: "workspace.welcome.library.fortune.item.vent.suitable",
    avoid: "workspace.welcome.library.fortune.item.vent.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.song",
    suitable: "workspace.welcome.library.fortune.item.song.suitable",
    avoid: "workspace.welcome.library.fortune.item.song.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.headphones",
    suitable: "workspace.welcome.library.fortune.item.headphones.suitable",
    avoid: "workspace.welcome.library.fortune.item.headphones.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.earlySleep",
    suitable: "workspace.welcome.library.fortune.item.earlySleep.suitable",
    avoid: "workspace.welcome.library.fortune.item.earlySleep.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.nap",
    suitable: "workspace.welcome.library.fortune.item.nap.suitable",
    avoid: "workspace.welcome.library.fortune.item.nap.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.holiday",
    suitable: "workspace.welcome.library.fortune.item.holiday.suitable",
    avoid: "workspace.welcome.library.fortune.item.holiday.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.newProject",
    suitable: "workspace.welcome.library.fortune.item.newProject.suitable",
    avoid: "workspace.welcome.library.fortune.item.newProject.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.oldProject",
    suitable: "workspace.welcome.library.fortune.item.oldProject.suitable",
    avoid: "workspace.welcome.library.fortune.item.oldProject.avoid",
  },
] as const;

/** Time-of-day copy: the greeting and a title pool per day kind. */
const TIME_SLOTS = {
  morning: {
    greeting: "workspace.welcome.library.welcome.morning",
    weekday: [
      "workspace.welcome.library.welcome.morning.weekday.1",
      "workspace.welcome.library.welcome.morning.weekday.2",
      "workspace.welcome.library.welcome.morning.weekday.3",
    ],
    friday: [
      "workspace.welcome.library.welcome.morning.friday.1",
      "workspace.welcome.library.welcome.morning.friday.2",
      "workspace.welcome.library.welcome.morning.friday.3",
    ],
    saturday: [
      "workspace.welcome.library.welcome.morning.saturday.1",
      "workspace.welcome.library.welcome.morning.saturday.2",
      "workspace.welcome.library.welcome.morning.saturday.3",
    ],
    sunday: [
      "workspace.welcome.library.welcome.morning.sunday.1",
      "workspace.welcome.library.welcome.morning.sunday.2",
      "workspace.welcome.library.welcome.morning.sunday.3",
    ],
  },
  afternoon: {
    greeting: "workspace.welcome.library.welcome.afternoon",
    weekday: [
      "workspace.welcome.library.welcome.afternoon.weekday.1",
      "workspace.welcome.library.welcome.afternoon.weekday.2",
      "workspace.welcome.library.welcome.afternoon.weekday.3",
    ],
    friday: [
      "workspace.welcome.library.welcome.afternoon.friday.1",
      "workspace.welcome.library.welcome.afternoon.friday.2",
      "workspace.welcome.library.welcome.afternoon.friday.3",
    ],
    saturday: [
      "workspace.welcome.library.welcome.afternoon.saturday.1",
      "workspace.welcome.library.welcome.afternoon.saturday.2",
      "workspace.welcome.library.welcome.afternoon.saturday.3",
    ],
    sunday: [
      "workspace.welcome.library.welcome.afternoon.sunday.1",
      "workspace.welcome.library.welcome.afternoon.sunday.2",
      "workspace.welcome.library.welcome.afternoon.sunday.3",
    ],
  },
  evening: {
    greeting: "workspace.welcome.library.welcome.evening",
    weekday: [
      "workspace.welcome.library.welcome.evening.weekday.1",
      "workspace.welcome.library.welcome.evening.weekday.2",
      "workspace.welcome.library.welcome.evening.weekday.3",
    ],
    friday: [
      "workspace.welcome.library.welcome.evening.friday.1",
      "workspace.welcome.library.welcome.evening.friday.2",
      "workspace.welcome.library.welcome.evening.friday.3",
    ],
    saturday: [
      "workspace.welcome.library.welcome.evening.saturday.1",
      "workspace.welcome.library.welcome.evening.saturday.2",
      "workspace.welcome.library.welcome.evening.saturday.3",
    ],
    sunday: [
      "workspace.welcome.library.welcome.evening.sunday.1",
      "workspace.welcome.library.welcome.evening.sunday.2",
      "workspace.welcome.library.welcome.evening.sunday.3",
    ],
  },
  late: {
    greeting: "workspace.welcome.library.welcome.late",
    weekday: [
      "workspace.welcome.library.welcome.late.weekday.1",
      "workspace.welcome.library.welcome.late.weekday.2",
      "workspace.welcome.library.welcome.late.weekday.3",
    ],
    friday: [
      "workspace.welcome.library.welcome.late.friday.1",
      "workspace.welcome.library.welcome.late.friday.2",
      "workspace.welcome.library.welcome.late.friday.3",
    ],
    saturday: [
      "workspace.welcome.library.welcome.late.saturday.1",
      "workspace.welcome.library.welcome.late.saturday.2",
      "workspace.welcome.library.welcome.late.saturday.3",
    ],
    sunday: [
      "workspace.welcome.library.welcome.late.sunday.1",
      "workspace.welcome.library.welcome.late.sunday.2",
      "workspace.welcome.library.welcome.late.sunday.3",
    ],
  },
} as const;

/** Which title pool fits the local weekday. */
type DayKind = "weekday" | "friday" | "saturday" | "sunday";

/** Day kind used to pick the weekend-aware title pool. */
function dayKind(day: number): DayKind {
  if (day === 0) {
    return "sunday";
  }
  if (day === 6) {
    return "saturday";
  }
  if (day === 5) {
    return "friday";
  }
  return "weekday";
}

/** Copy slot for the local hour. */
function timeSlot(hour: number): keyof typeof TIME_SLOTS {
  if (hour < 5) {
    return "late";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 18) {
    return "afternoon";
  }
  return "evening";
}

/** Returns the random check-in draw delay used after the user starts a draw. */
function randomDrawDelay(): number {
  return 1400 + Math.random() * 1400;
}

/** Library-wide totals shown in the welcome panel's stat grid. */
interface LibraryTotals {
  charts: number;
  notes: number;
  events: number;
  editing: number;
}

/** Sums the entries without disturbing the list's own order or filtering. */
function sumEntries(entries: readonly LibraryEntry[]): LibraryTotals {
  let notes = 0;
  let events = 0;
  let editing = 0;
  for (const entry of entries) {
    const project = entry.source.project;
    notes += project.noteCount;
    events += Number.isFinite(project.eventCount) ? project.eventCount : 0;
    editing += Number.isFinite(project.editSeconds) ? project.editSeconds : 0;
  }
  return { charts: entries.length, notes, events, editing };
}

/** Borderless welcome, statistics, and check-in panel for the empty column. */
export function LibraryWelcome({
  entries,
  loading,
}: {
  /** Every stored entry; search filtering never changes these totals. */
  entries: readonly LibraryEntry[];
  /** The first library read is still in flight. */
  loading: boolean;
}) {
  const { t, language } = useTranslation();
  const panelId = useId();
  const [now, setNow] = useState(() => new Date());
  const today = localDay(now);
  const [checkedInDay, setCheckedInDay] = useState(readCheckInDay);
  const checkedIn = checkedInDay === today;
  const [drawing, setDrawing] = useState(false);
  const drawTimer = useRef<number | null>(null);
  // Crossing midnight resets the check-in, the date, and the daily draw.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // The sign-in draw is a short random spin; leaving the panel must not leave
  // a timer behind, because the recorded check-in survives the unmount.
  useEffect(
    () => () => {
      if (drawTimer.current !== null) {
        window.clearTimeout(drawTimer.current);
      }
    },
    [],
  );
  const totals = useMemo(() => sumEntries(entries), [entries]);
  // Only the first read is unknown; a refresh keeps the settled totals visible.
  const pending = loading && entries.length === 0;
  const hour = now.getHours();
  const slotName = timeSlot(hour);
  const slot = TIME_SLOTS[slotName];
  const kind = dayKind(now.getDay());
  const titleKey =
    slot[kind][fortuneIndexForDay(`${today}:${slotName}:${kind}`, slot[kind].length)];
  const night = slotName === "evening" || slotName === "late";
  const dateLabel = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    weekday: "short",
    month: "long",
    day: "numeric",
  }).format(now);
  const rank = FORTUNE_RANKS[fortuneIndexForDay(today, FORTUNE_RANKS.length)];
  // Luogu replaces one side on the two extreme ranks; otherwise a good day
  // leans toward more do items and a bad day toward more don't items.
  const specialSuitable = rank.id === "dire";
  const specialAvoid = rank.id === "great";
  const suitableCount = specialSuitable ? 0 : rank.tone === "good" ? 3 : 2;
  const avoidCount = specialAvoid ? 0 : rank.tone === "bad" || rank.tone === "worst" ? 3 : 2;
  const draw = dailyFortunePicks(today, suitableCount + avoidCount, FORTUNE_ITEMS.length, "items");
  const suitableItems = draw.slice(0, suitableCount).map((index) => FORTUNE_ITEMS[index]);
  const avoidItems = draw.slice(suitableCount).map((index) => FORTUNE_ITEMS[index]);
  const value = (text: string) => (pending ? "…" : text);
  /** Records today's check-in and spins for a random draw before the reveal. */
  const checkIn = () => {
    writeCheckInDay(today);
    setCheckedInDay(today);
    setDrawing(true);
    if (drawTimer.current !== null) {
      window.clearTimeout(drawTimer.current);
    }
    drawTimer.current = window.setTimeout(() => {
      drawTimer.current = null;
      setDrawing(false);
    }, randomDrawDelay());
  };
  return (
    <aside className="redux-library-detail redux-library-welcome" aria-labelledby={panelId}>
      <div className="redux-library-welcome-inner">
        <header className="redux-library-welcome-head">
          <p className="redux-library-welcome-eyebrow">
            <Icon name={night ? "moon" : "sun"} size={14} />
            <span>{t(slot.greeting)}</span>
            <span className="redux-library-welcome-dot" aria-hidden="true" />
            <span>{dateLabel}</span>
          </p>
          <h2 className="redux-library-welcome-title" id={panelId}>
            {t(titleKey)}
          </h2>
        </header>
        <dl
          className="redux-library-welcome-stats"
          data-pending={pending ? "true" : undefined}
          aria-busy={pending || undefined}
        >
          <div>
            <dt>{t("workspace.welcome.library.stats.charts")}</dt>
            <dd>{value(formatCount(totals.charts, language))}</dd>
          </div>
          <div>
            <dt>{t("workspace.welcome.library.stats.notes")}</dt>
            <dd>{value(formatCount(totals.notes, language))}</dd>
          </div>
          <div>
            <dt>{t("workspace.welcome.library.stats.events")}</dt>
            <dd>{value(formatCount(totals.events, language))}</dd>
          </div>
          <div>
            <dt>{t("workspace.welcome.library.stats.duration")}</dt>
            <dd className="redux-library-welcome-stat-duration">
              {value(formatChartingTime(totals.editing))}
            </dd>
          </div>
        </dl>
        <section className="redux-library-welcome-checkin" aria-labelledby={`${panelId}-checkin`}>
          <div className="redux-library-welcome-checkin-head">
            <h3 className="redux-library-welcome-checkin-title" id={`${panelId}-checkin`}>
              {t("workspace.welcome.library.checkIn.title")}
            </h3>
          </div>
          <div className="redux-library-welcome-checkin-body">
            {checkedIn ? (
              drawing ? (
                <div className="redux-library-welcome-checkin-drawing">
                  <Spinner label={t("workspace.welcome.library.checkIn.drawing")} />
                  <span aria-hidden="true">{t("workspace.welcome.library.checkIn.drawing")}</span>
                </div>
              ) : (
                <div className="redux-library-welcome-fortune" data-tone={rank.tone} role="status">
                  <div className="redux-library-welcome-fortune-head">
                    <span className="redux-library-welcome-fortune-label">
                      <Icon name="star" size={12} />
                      {t("workspace.welcome.library.fortune.title")}
                    </span>
                    <span className="redux-library-welcome-fortune-rank">{t(rank.label)}</span>
                  </div>
                  <div className="redux-library-welcome-fortune-advice">
                    <div className="redux-library-welcome-fortune-column is-suitable">
                      <span
                        className="redux-library-welcome-fortune-column-title"
                        aria-hidden="true"
                      >
                        {t("workspace.welcome.library.fortune.suitable")}
                      </span>
                      <ul
                        className="redux-library-welcome-fortune-list"
                        aria-label={t("workspace.welcome.library.fortune.suitable")}
                      >
                        {specialSuitable ? (
                          <>
                            <li className="is-special">
                              <span className="redux-library-welcome-fortune-item">
                                {t("workspace.welcome.library.fortune.allAvoid")}
                              </span>
                              <span className="redux-library-welcome-fortune-note">
                                {t("workspace.welcome.library.fortune.allAvoidNote")}
                              </span>
                            </li>
                            <li className="is-special">
                              <span className="redux-library-welcome-fortune-item">
                                {t("workspace.welcome.library.fortune.allAvoidMore")}
                              </span>
                              <span className="redux-library-welcome-fortune-note">
                                {t("workspace.welcome.library.fortune.allAvoidMoreNote")}
                              </span>
                            </li>
                          </>
                        ) : (
                          suitableItems.map((item) => (
                            <li key={item.label}>
                              <span className="redux-library-welcome-fortune-item">
                                {t(item.label)}
                              </span>
                              <span className="redux-library-welcome-fortune-note">
                                {t(item.suitable)}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                    <div className="redux-library-welcome-fortune-column is-avoid">
                      <span
                        className="redux-library-welcome-fortune-column-title"
                        aria-hidden="true"
                      >
                        {t("workspace.welcome.library.fortune.avoid")}
                      </span>
                      <ul
                        className="redux-library-welcome-fortune-list"
                        aria-label={t("workspace.welcome.library.fortune.avoid")}
                      >
                        {specialAvoid ? (
                          <>
                            <li className="is-special">
                              <span className="redux-library-welcome-fortune-item">
                                {t("workspace.welcome.library.fortune.allSuitable")}
                              </span>
                              <span className="redux-library-welcome-fortune-note">
                                {t("workspace.welcome.library.fortune.allSuitableNote")}
                              </span>
                            </li>
                            <li className="is-special">
                              <span className="redux-library-welcome-fortune-item">
                                {t("workspace.welcome.library.fortune.allSuitableMore")}
                              </span>
                              <span className="redux-library-welcome-fortune-note">
                                {t("workspace.welcome.library.fortune.allSuitableMoreNote")}
                              </span>
                            </li>
                          </>
                        ) : (
                          avoidItems.map((item) => (
                            <li key={item.label}>
                              <span className="redux-library-welcome-fortune-item">
                                {t(item.label)}
                              </span>
                              <span className="redux-library-welcome-fortune-note">
                                {t(item.avoid)}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="redux-library-welcome-checkin-prompt">
                <p className="redux-library-welcome-checkin-copy">
                  {t("workspace.welcome.library.checkIn.description")}
                </p>
                <Button
                  variant="outlined"
                  size="lg"
                  className="redux-library-welcome-checkin-action"
                  iconText
                  onClick={checkIn}
                >
                  <Icon name="calendar" size={18} />
                  {t("workspace.welcome.library.checkIn.action")}
                </Button>
              </div>
            )}
          </div>
        </section>
      </div>
    </aside>
  );
}
