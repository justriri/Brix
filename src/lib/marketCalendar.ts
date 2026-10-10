/**
 * Self-computed NYSE/Nasdaq market-hours calendar.
 *
 * Per the research report, none of bStocks/Ondo/xStocks expose a reliable
 * "is the underlying market open" boolean, and no free turnkey oracle for
 * this exists either — the realistic path (confirmed by the research and
 * by both competing hackathon projects, yostocks/OneTicker) is to compute
 * it from NYSE's officially published hours + holiday calendar.
 *
 * Holiday/early-close dates below were fetched live from
 * https://www.nyse.com/markets/hours-calendars during this build session
 * (2026-09-29) for calendar year 2026, with Christmas Day (Fri Dec 25,
 * 2026) added explicitly — it is an invariant NYSE holiday that the source
 * fetch's summary happened to truncate before reaching. THIS LIST MUST BE
 * REFRESHED EVERY CALENDAR YEAR — it is not derived algorithmically.
 */

const NYSE_TIME_ZONE = "America/New_York";

/** Full-day market closures, as YYYY-MM-DD in America/New_York. */
const FULL_HOLIDAYS_2026 = new Set<string>([
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King, Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth National Independence Day
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day (weekday; added explicitly, see file header)
]);

/** Early-close (1:00pm ET) trading days, as YYYY-MM-DD in America/New_York. */
const EARLY_CLOSE_DAYS_2026 = new Set<string>([
  "2026-07-03", // Independence Day observed
  "2026-11-27", // Day after Thanksgiving
  "2026-12-24", // Christmas Eve
]);

const REGULAR_OPEN_MIN = 9 * 60 + 30; // 09:30
const REGULAR_CLOSE_MIN = 16 * 60; // 16:00
const EARLY_CLOSE_MIN = 13 * 60; // 13:00

export interface NyWallClock {
  dateKey: string; // YYYY-MM-DD in America/New_York
  weekday: number; // 0=Sunday .. 6=Saturday
  minutesSinceMidnight: number;
}

/** Converts any instant to its America/New_York wall-clock date/time, independent of server timezone. */
export function toNyWallClock(instant: Date): NyWallClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NYSE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(instant);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = Number(get("hour"));
  const minute = Number(get("minute"));
  // Intl can render midnight as "24"; normalize.
  if (hour === 24) hour = 0;

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    dateKey: `${year}-${month}-${day}`,
    weekday: weekdayMap[get("weekday")] ?? -1,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

export interface MarketCalendarStatus {
  isOpen: boolean;
  reason: string;
  dateKeyNy: string;
}

/**
 * Determines whether the US equity market is open at a given instant
 * (defaults to now). This governs the "weekend gap" the whole product is
 * built around — most of the week (~136 of 168 hours) this returns false.
 */
export function getUsEquityMarketStatus(at: Date = new Date()): MarketCalendarStatus {
  const wc = toNyWallClock(at);

  if (wc.weekday === 0 || wc.weekday === 6) {
    return { isOpen: false, reason: "Weekend", dateKeyNy: wc.dateKey };
  }
  if (FULL_HOLIDAYS_2026.has(wc.dateKey)) {
    return { isOpen: false, reason: "NYSE holiday", dateKeyNy: wc.dateKey };
  }

  const closeMin = EARLY_CLOSE_DAYS_2026.has(wc.dateKey) ? EARLY_CLOSE_MIN : REGULAR_CLOSE_MIN;

  if (wc.minutesSinceMidnight < REGULAR_OPEN_MIN) {
    return { isOpen: false, reason: "Before market open (09:30 ET)", dateKeyNy: wc.dateKey };
  }
  if (wc.minutesSinceMidnight >= closeMin) {
    return {
      isOpen: false,
      reason: EARLY_CLOSE_DAYS_2026.has(wc.dateKey)
        ? "After early close (13:00 ET)"
        : "After market close (16:00 ET)",
      dateKeyNy: wc.dateKey,
    };
  }

  return { isOpen: true, reason: "Regular trading session", dateKeyNy: wc.dateKey };
}

/**
 * Finds the next America/New_York 09:30 market open at or after `from`,
 * skipping weekends and full holidays. Used to set a weekend protection
 * policy's expiry (resolution at next reopen) — walks forward day by day
 * rather than assuming "next Monday", since a Monday holiday (e.g. MLK Day,
 * Memorial Day, Labor Day) pushes the real reopen to Tuesday.
 */
export function getNextMarketOpen(from: Date = new Date()): Date {
  const cursor = new Date(from);
  for (let i = 0; i < 10; i++) {
    const wc = toNyWallClock(cursor);
    const isWeekend = wc.weekday === 0 || wc.weekday === 6;
    if (!isWeekend && !FULL_HOLIDAYS_2026.has(wc.dateKey) && wc.minutesSinceMidnight < REGULAR_OPEN_MIN) {
      // Same NY calendar day, before open: today's open is next.
      const [y, m, d] = wc.dateKey.split("-").map(Number);
      return nyWallClockToUtc(y, m, d, 9, 30);
    }
    if (!isWeekend && !FULL_HOLIDAYS_2026.has(wc.dateKey) && wc.minutesSinceMidnight < REGULAR_CLOSE_MIN) {
      // Market is open right now — "next open" is effectively now.
      return cursor;
    }
    // Advance to the next NY calendar day, 00:00, and try again.
    cursor.setTime(cursor.getTime() + (24 * 60 * 60 * 1000 - wc.minutesSinceMidnight * 60 * 1000) + 1000);
  }
  throw new Error("Could not find next market open within 10 days — check holiday calendar coverage.");
}

/** Converts a America/New_York wall-clock date+time to a real UTC Date, accounting for DST via Intl round-tripping. */
function nyWallClockToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  // Start from a naive UTC guess, then correct using the offset Intl reports for that instant.
  const naiveUtc = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const offsetMinutes = getNyUtcOffsetMinutes(naiveUtc);
  return new Date(naiveUtc.getTime() - offsetMinutes * 60 * 1000);
}

function getNyUtcOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NYSE_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const match = tzName.match(/GMT([+-]\d+)/);
  const hours = match ? Number(match[1]) : -5;
  return hours * 60;
}
