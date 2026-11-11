/** Local-day check-in and deterministic fortune selection for the welcome panel. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  dailyFortunePicks,
  fortuneIndexForDay,
  localDay,
  readCheckInDay,
  writeCheckInDay,
} from "../../../frontend/screens/welcome/library/welcomeCheckIn.ts";

test("localDay formats the local calendar date with padded parts", () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(localDay(new Date(2026, 10, 11, 0, 1)), "2026-11-11");
});

test("the fortune index is stable for a day and stays inside the list", () => {
  const day = "2026-11-11";
  const first = fortuneIndexForDay(day, 6);
  assert.equal(first, fortuneIndexForDay(day, 6));
  assert.ok(Number.isInteger(first));
  assert.ok(first >= 0 && first < 6);
  assert.equal(fortuneIndexForDay(day, 0), 0);
});

test("the fortune index reaches every entry across consecutive days", () => {
  const days = Array.from({ length: 24 }, (_, offset) => localDay(new Date(2026, 0, 1 + offset)));
  const draws = new Set(days.map((day) => fortuneIndexForDay(day, 6)));
  assert.equal(draws.size, 6);
});

test("daily fortune picks are stable, distinct, and inside the pool", () => {
  const day = "2026-11-11";
  const picks = dailyFortunePicks(day, 3, 8, "suitable");
  assert.deepEqual(picks, dailyFortunePicks(day, 3, 8, "suitable"));
  assert.equal(new Set(picks).size, 3);
  assert.ok(picks.every((index) => Number.isInteger(index) && index >= 0 && index < 8));
});

test("a small pool returns each item once", () => {
  assert.deepEqual(dailyFortunePicks("2026-11-11", 3, 1, "suitable"), [0]);
  assert.deepEqual(dailyFortunePicks("2026-11-11", 3, 2, "suitable").sort(), [0, 1]);
});

test("different salts vary the daily pick over a week", () => {
  const days = Array.from({ length: 8 }, (_, offset) => localDay(new Date(2026, 0, 1 + offset)));
  const differs = days.some((day) => {
    const suitable = dailyFortunePicks(day, 3, 8, "suitable");
    const avoid = dailyFortunePicks(day, 3, 8, "avoid");
    return suitable.some((index, position) => index !== avoid[position]);
  });
  assert.equal(differs, true);
});

test("a check-in round-trips through localStorage", () => {
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
    },
  };
  try {
    assert.equal(readCheckInDay(), null);
    writeCheckInDay("2026-11-11");
    assert.equal(readCheckInDay(), "2026-11-11");
  } finally {
    delete globalThis.window;
  }
});
