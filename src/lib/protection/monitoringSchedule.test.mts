import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDefaultWeekendSchedule, buildScheduleForExpiry } from "./monitoringSchedule.ts";

test("buildScheduleForExpiry places the final checkpoint exactly at the real expiry, not an assumed +3 days", () => {
  const startedAt = 1_000_000;
  const expiresAt = startedAt + 10 * 24 * 60 * 60 * 1000; // a 10-day window, not the usual 3
  const schedule = buildScheduleForExpiry(startedAt, expiresAt);

  assert.equal(schedule[2].checkpoint, "monday");
  assert.equal(schedule[2].dueAt, expiresAt, "the final checkpoint must land exactly at the real on-chain expiry");
  assert.equal(schedule[2].isFinal, true);
  assert.ok(schedule[0].dueAt > startedAt && schedule[0].dueAt < schedule[1].dueAt);
  assert.ok(schedule[1].dueAt < schedule[2].dueAt);
});

test("buildScheduleForExpiry matches buildDefaultWeekendSchedule exactly for the standard 3-day case", () => {
  const startedAt = 1_000_000;
  const expiresAt = startedAt + 3 * 24 * 60 * 60 * 1000;

  const derived = buildScheduleForExpiry(startedAt, expiresAt);
  const legacy = buildDefaultWeekendSchedule(startedAt);

  assert.deepEqual(derived, legacy, "a real policy whose window happens to be exactly 3 days must behave identically to the legacy default");
});
