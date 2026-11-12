/**
 * Borderless welcome panel for the home library's detail column.
 *
 * It fills the column while no chart is selected: a time-of-day greeting,
 * the library's running totals, and a local-day draw that reveals a daily
 * fortune. The fortune pairs each item with a suitable and an avoid note, so the
 * reading stays concrete and slightly cheeky instead of reading like a generic
 * horoscope. Drawing is a small ritual rather than a button press: the reader
 * holds the draw button while green liquid fills the card on an ease-in curve,
 * and the card trembles harder as the charge builds; letting go drains it back
 * down. The day lives in localStorage and the fortune is seeded from that day
 * plus a per-installation seed, so two installations drawing on the same day do
 * not get the same reading.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "../../../../design/components/button/Button.tsx";
import { Icon } from "../../../../design/components/icon/Icon.tsx";
import { useTranslation } from "../../../../i18n/react.ts";
import {
  advanceHoldFill,
  holdFillFraction,
  holdShake,
  HOLD_DRAIN_MS,
  REVEAL_DRAIN_MS,
} from "./holdToDraw.ts";
import type { LibraryEntry } from "./libraryEntries.ts";
import { formatChartingTime, formatCount } from "./libraryFormat.ts";
import {
  dailyFortunePicks,
  dailyFortuneSeed,
  fortuneIndexForSeed,
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
    label: "workspace.welcome.library.fortune.item.pickSong",
    suitable: "workspace.welcome.library.fortune.item.pickSong.suitable",
    avoid: "workspace.welcome.library.fortune.item.pickSong.avoid",
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
    label: "workspace.welcome.library.fortune.item.studyChart",
    suitable: "workspace.welcome.library.fortune.item.studyChart.suitable",
    avoid: "workspace.welcome.library.fortune.item.studyChart.avoid",
  },
  {
    label: "workspace.welcome.library.fortune.item.oldWork",
    suitable: "workspace.welcome.library.fortune.item.oldWork.suitable",
    avoid: "workspace.welcome.library.fortune.item.oldWork.avoid",
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
    label: "workspace.welcome.library.fortune.item.community",
    suitable: "workspace.welcome.library.fortune.item.community.suitable",
    avoid: "workspace.welcome.library.fortune.item.community.avoid",
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

/** Time-of-day greeting shown above the library totals. */
const TIME_GREETINGS = {
  morning: "workspace.welcome.library.welcome.morning",
  afternoon: "workspace.welcome.library.welcome.afternoon",
  evening: "workspace.welcome.library.welcome.evening",
  late: "workspace.welcome.library.welcome.late",
} as const;

/** Copy slot for the local hour. */
function timeSlot(hour: number): keyof typeof TIME_GREETINGS {
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

/** A frame longer than this is a wake-up gap, not a real frame. */
const HOLD_FRAME_CLAMP_MS = 64;

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

/** Borderless welcome, statistics, and daily draw panel for the empty column. */
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
  // Crossing midnight resets the check-in, the date, and the daily draw.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const totals = useMemo(() => sumEntries(entries), [entries]);
  // Only the first read is unknown; a refresh keeps the settled totals visible.
  const pending = loading && entries.length === 0;
  const hour = now.getHours();
  const slotName = timeSlot(hour);
  const night = slotName === "evening" || slotName === "late";
  const dateLabel = new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", {
    weekday: "short",
    month: "long",
    day: "numeric",
  }).format(now);
  // One seed per local day for this installation: reloading the panel keeps the
  // reading while another installation draws its own.
  const seed = useMemo(() => dailyFortuneSeed(today), [today]);
  const rank = FORTUNE_RANKS[fortuneIndexForSeed(seed, FORTUNE_RANKS.length)];
  // The two extreme ranks replace one side; otherwise a good day leans toward
  // more do items and a bad day toward more don't items.
  const specialSuitable = rank.id === "dire";
  const specialAvoid = rank.id === "great";
  const suitableCount = specialSuitable ? 0 : rank.tone === "good" ? 3 : 2;
  const avoidCount = specialAvoid ? 0 : rank.tone === "bad" || rank.tone === "worst" ? 3 : 2;
  const draw = dailyFortunePicks(seed, suitableCount + avoidCount, FORTUNE_ITEMS.length, "items");
  const suitableItems = draw.slice(0, suitableCount).map((index) => FORTUNE_ITEMS[index]);
  const avoidItems = draw.slice(suitableCount).map((index) => FORTUNE_ITEMS[index]);
  const value = (text: string) => (pending ? "…" : text);
  /** Records today's draw; the liquid drains while the reading appears. */
  const recordDraw = useCallback(() => {
    writeCheckInDay(today);
    setCheckedInDay(today);
  }, [today]);
  const cardRef = useRef<HTMLElement>(null);
  const fillRef = useRef(0);
  const holdingRef = useRef(false);
  const completedRef = useRef(false);
  const [holding, setHolding] = useState(false);
  // The press loop writes the eased charge and the card vibration onto the card
  // through refs, so only the start and end of the press re-render. It also
  // drains after completion.
  useEffect(() => {
    if (!holding) {
      return;
    }
    const card = cardRef.current;
    if (!card) {
      return;
    }
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame: number | null = null;
    let last = performance.now();
    let clock = 0;
    /** Paint the eased charge and the vibration for this frame. */
    const paint = (shake: ReturnType<typeof holdShake> | null) => {
      card.style.setProperty(
        "--hold-fill",
        `${(holdFillFraction(fillRef.current) * 100).toFixed(2)}%`,
      );
      if (fillRef.current > 0) {
        card.setAttribute("data-hold", "true");
      } else {
        card.removeAttribute("data-hold");
      }
      if (shake) {
        card.style.transform = `translate3d(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px, 0) rotate(${shake.rotate.toFixed(3)}deg)`;
      } else {
        card.style.removeProperty("transform");
      }
    };
    const step = (time: number) => {
      frame = null;
      const elapsed = Math.min(HOLD_FRAME_CLAMP_MS, Math.max(0, time - last));
      last = time;
      clock += elapsed;
      fillRef.current = advanceHoldFill(
        fillRef.current,
        elapsed,
        holdingRef.current,
        completedRef.current ? REVEAL_DRAIN_MS : HOLD_DRAIN_MS,
      );
      paint(
        holdingRef.current && fillRef.current > 0 && !reduceMotion
          ? holdShake(fillRef.current, clock)
          : null,
      );
      if (!completedRef.current && fillRef.current >= 1) {
        completedRef.current = true;
        holdingRef.current = false;
        recordDraw();
      }
      if (holdingRef.current || fillRef.current > 0) {
        frame = requestAnimationFrame(step);
      } else {
        setHolding(false);
      }
    };
    paint(null);
    frame = requestAnimationFrame(step);
    return () => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      card.style.removeProperty("transform");
    };
  }, [holding, recordDraw]);
  /** Starts the charge; the loop only exists while the liquid is on screen. */
  const startHold = () => {
    if (completedRef.current) {
      return;
    }
    holdingRef.current = true;
    setHolding(true);
  };
  /** Ends the press; the loop keeps draining the charge back to zero. */
  const releaseHold = () => {
    holdingRef.current = false;
    if (!holding && fillRef.current > 0) {
      setHolding(true);
    }
  };
  return (
    <aside className="redux-library-detail redux-library-welcome" aria-labelledby={panelId}>
      <div className="redux-library-welcome-inner">
        <header className="redux-library-welcome-head">
          <p className="redux-library-welcome-eyebrow" id={panelId}>
            <Icon name={night ? "moon" : "sun"} size={14} />
            <span>{t(TIME_GREETINGS[slotName])}</span>
            <span className="redux-library-welcome-dot" aria-hidden="true" />
            <span>{dateLabel}</span>
          </p>
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
        <section
          ref={cardRef}
          className="redux-library-welcome-checkin"
          aria-label={checkedIn ? t("workspace.welcome.library.fortune.title") : undefined}
          aria-labelledby={checkedIn ? undefined : `${panelId}-checkin`}
        >
          <span className="redux-library-welcome-liquid" aria-hidden="true">
            <span className="redux-library-welcome-liquid-fill" />
          </span>
          <div className="redux-library-welcome-checkin-body">
            {checkedIn ? (
              <div className="redux-library-welcome-fortune" data-tone={rank.tone} role="status">
                <div className="redux-library-welcome-fortune-head">
                  <span className="redux-library-welcome-fortune-label">
                    {t("workspace.welcome.library.fortune.title")}
                  </span>
                  <span className="redux-library-welcome-fortune-rank">{t(rank.label)}</span>
                </div>
                <div className="redux-library-welcome-fortune-advice">
                  <div className="redux-library-welcome-fortune-column is-suitable">
                    <span className="redux-library-welcome-fortune-column-title" aria-hidden="true">
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
                    <span className="redux-library-welcome-fortune-column-title" aria-hidden="true">
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
            ) : (
              <div className="redux-library-welcome-checkin-prompt">
                <p className="redux-library-welcome-checkin-copy" id={`${panelId}-checkin`}>
                  {t("workspace.welcome.library.checkIn.description")}
                </p>
                <Button
                  variant="outlined"
                  size="lg"
                  className="redux-library-welcome-checkin-action"
                  iconText
                  onPointerDown={(event) => {
                    if (event.button !== 0) {
                      return;
                    }
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startHold();
                  }}
                  onPointerUp={releaseHold}
                  onPointerCancel={releaseHold}
                  onLostPointerCapture={releaseHold}
                  onKeyDown={(event) => {
                    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                      startHold();
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      releaseHold();
                    }
                  }}
                  onBlur={releaseHold}
                  onContextMenu={(event) => event.preventDefault()}
                  onClick={(event) => {
                    // Assistive technology activates a button with a click that
                    // carries no pointer detail; that reader cannot hold, so the
                    // formal activation draws directly.
                    if (event.detail === 0) {
                      recordDraw();
                    }
                  }}
                >
                  <Icon name="star" size={18} />
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
