/** Local-day check-in and per-installation deterministic fortune selection. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyFortunePicks,
  dailyFortuneSeed,
  fortuneIndexForSeed,
  localDay,
  readCheckInDay,
  readFortuneSeed,
  writeCheckInDay,
} from "../../../frontend/screens/welcome/library/welcomeCheckIn.ts";

const SEED_KEY = "rpe-redux.library.fortune-seed";
const INSTALL_SEED = "install-a";

/** Install a fake `window.localStorage` for the duration of `run`. */
function withStorage(entries, run) {
  const stored = new Map(entries);
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
  };
  try {
    return run(stored);
  } finally {
    delete globalThis.window;
  }
}

test("localDay formats the local calendar date with padded parts", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDay(new Date(2026, 10, 11, 0, 1)), "2026-11-11");
});

test("the fortune index is stable for a seed and stays inside the list", () => {
  const seed = `${INSTALL_SEED}:2026-11-11`;
  const first = fortuneIndexForSeed(seed, 6);
  assert.equal(first, fortuneIndexForSeed(seed, 6));
  assert.ok(Number.isInteger(first));
  assert.ok(first >= 0 && first < 6);
  assert.equal(fortuneIndexForSeed(seed, 0), 0);
});

test("the fortune index reaches every entry across consecutive days", () => {
  const days = Array.from({ length: 24 }, (_, offset) => localDay(new Date(2026, 0, 1 + offset)));
  const draws = new Set(days.map((day) => fortuneIndexForSeed(`${INSTALL_SEED}:${day}`, 6)));
  assert.equal(draws.size, 6);
});

test("two installations draw differently on the same day", () => {
  const days = Array.from({ length: 8 }, (_, offset) => localDay(new Date(2026, 0, 1 + offset)));
  const differs = days.some(
    (day) =>
      fortuneIndexForSeed(`install-a:${day}`, 6) !== fortuneIndexForSeed(`install-b:${day}`, 6),
  );
  assert.equal(differs, true);
});

test("daily fortune picks are stable, distinct, and inside the pool", () => {
  const seed = `${INSTALL_SEED}:2026-11-11`;
  const picks = dailyFortunePicks(seed, 3, 8, "suitable");
  assert.deepEqual(picks, dailyFortunePicks(seed, 3, 8, "suitable"));
  assert.equal(new Set(picks).size, 3);
  assert.ok(picks.every((index) => Number.isInteger(index) && index >= 0 && index < 8));
});

test("a small pool returns each item once", () => {
  const seed = `${INSTALL_SEED}:2026-11-11`;
  assert.deepEqual(dailyFortunePicks(seed, 3, 1, "suitable"), [0]);
  assert.deepEqual(dailyFortunePicks(seed, 3, 2, "suitable").sort(), [0, 1]);
});

test("different salts vary the daily pick over a week", () => {
  const days = Array.from({ length: 8 }, (_, offset) => localDay(new Date(2026, 0, 1 + offset)));
  const differs = days.some((day) => {
    const seed = `${INSTALL_SEED}:${day}`;
    const suitable = dailyFortunePicks(seed, 3, 8, "suitable");
    const avoid = dailyFortunePicks(seed, 3, 8, "avoid");
    return suitable.some((index, position) => index !== avoid[position]);
  });
  assert.equal(differs, true);
});

test("the daily seed keeps one installation stable and moves with the day", () => {
  withStorage([[SEED_KEY, INSTALL_SEED]], () => {
    assert.equal(dailyFortuneSeed("2026-11-11"), `${INSTALL_SEED}:2026-11-11`);
    assert.equal(dailyFortuneSeed("2026-11-11"), `${INSTALL_SEED}:2026-11-11`);
    assert.notEqual(dailyFortuneSeed("2026-11-12"), dailyFortuneSeed("2026-11-11"));
  });
});

test("a different stored installation seed changes the daily draw", () => {
  withStorage([[SEED_KEY, "install-a"]], (stored) => {
    const first = dailyFortuneSeed("2026-11-11");
    stored.set(SEED_KEY, "install-b");
    assert.notEqual(dailyFortuneSeed("2026-11-11"), first);
  });
});

test("the fortune seed is created once and persisted", () => {
  withStorage([], (stored) => {
    const first = readFortuneSeed();
    assert.ok(first.length > 0);
    assert.equal(stored.get(SEED_KEY), first);
    assert.equal(readFortuneSeed(), first);
  });
});

test("the fortune seed survives unavailable storage for the session", () => {
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error("storage is disabled");
      },
      setItem() {
        throw new Error("storage is disabled");
      },
    },
  };
  try {
    const first = readFortuneSeed();
    assert.ok(first.length > 0);
    assert.equal(readFortuneSeed(), first);
  } finally {
    delete globalThis.window;
  }
});

test("a check-in round-trips through localStorage", () => {
  withStorage([], () => {
    assert.equal(readCheckInDay(), null);
    writeCheckInDay("2026-11-11");
    assert.equal(readCheckInDay(), "2026-11-11");
  });
});
