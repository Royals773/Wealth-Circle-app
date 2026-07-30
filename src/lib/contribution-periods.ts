import type { ContributionFrequency } from "@/lib/types/database";

/**
 * Period math for contribution plans, done as plain calendar-date
 * arithmetic (year/month/day integers) rather than JS `Date` objects with
 * local time zones — every date in and out of this module is a plain
 * `YYYY-MM-DD` string, matching a Postgres `date` column exactly, so
 * there is no timezone or DST ambiguity to introduce. `Date.UTC` is only
 * ever used internally as a calendar calculator, always paired with the
 * matching UTC getters.
 */

export interface Period {
  start: string;
  end: string;
}

interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseISODate(iso: string): CalendarDate {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function toISODate({ y, m, d }: CalendarDate): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function toEpochDay(date: CalendarDate): number {
  return Math.floor(Date.UTC(date.y, date.m - 1, date.d) / 86_400_000);
}

function fromEpochDay(epochDay: number): CalendarDate {
  const dt = new Date(epochDay * 86_400_000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Adds (or subtracts, for a negative `days`) whole days to a plain
 * `YYYY-MM-DD` date string. Exported for callers that need a single
 * date-shifted value (e.g. applying a grace period to a due date)
 * without needing a full period. */
export function addDaysISO(iso: string, days: number): string {
  return toISODate(fromEpochDay(toEpochDay(parseISODate(iso)) + days));
}

/** Adds whole months to a calendar date, clamping the day to the target
 * month's length (e.g. 31 Jan + 1 month -> 28/29 Feb, never an invalid
 * date). Always anchored to the original date, not the previous step's
 * (possibly-clamped) result, so a plan starting 31 Jan doesn't
 * permanently drift to the 28th every month after its first February. */
function addMonthsClamped(date: CalendarDate, months: number): CalendarDate {
  const totalMonths = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(totalMonths / 12);
  const m = (((totalMonths % 12) + 12) % 12) + 1;
  const d = Math.min(date.d, daysInMonth(y, m));
  return { y, m, d };
}

/** Adds whole months to a plain `YYYY-MM-DD` date string — the
 * string-based counterpart to `addDaysISO`, used by loan scheduling to
 * turn a term-in-months into an end date. Same clamping behaviour as
 * `addMonthsClamped`. */
export function addMonths(iso: string, months: number): string {
  return toISODate(addMonthsClamped(parseISODate(iso), months));
}

const FREQUENCY_DAYS: Partial<Record<ContributionFrequency, number>> = {
  weekly: 7,
  biweekly: 14,
};

const FREQUENCY_MONTHS: Partial<Record<ContributionFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  annually: 12,
};

function periodStartForIndex(startDate: string, frequency: ContributionFrequency, index: number): string {
  const days = FREQUENCY_DAYS[frequency];
  if (days !== undefined) {
    return addDaysISO(startDate, days * index);
  }
  const months = FREQUENCY_MONTHS[frequency]!;
  return toISODate(addMonthsClamped(parseISODate(startDate), months * index));
}

function estimateIndex(startDate: string, frequency: ContributionFrequency, targetDate: string): number {
  if (targetDate <= startDate) return 0;

  const days = FREQUENCY_DAYS[frequency];
  if (days !== undefined) {
    const elapsedDays = toEpochDay(parseISODate(targetDate)) - toEpochDay(parseISODate(startDate));
    return Math.floor(elapsedDays / days);
  }

  const months = FREQUENCY_MONTHS[frequency]!;
  const s = parseISODate(startDate);
  const t = parseISODate(targetDate);
  const elapsedMonths = t.y * 12 + (t.m - 1) - (s.y * 12 + (s.m - 1));
  return Math.floor(elapsedMonths / months);
}

/** The index (0-based, relative to `startDate`) of the period containing
 * `targetDate`. The estimate from `estimateIndex` can be off by one at
 * month-length clamping boundaries, so it's corrected with a small,
 * bounded walk rather than trusted outright. */
function getPeriodIndexContaining(
  startDate: string,
  frequency: ContributionFrequency,
  targetDate: string,
): number {
  let index = Math.max(0, estimateIndex(startDate, frequency, targetDate));

  while (periodStartForIndex(startDate, frequency, index + 1) <= targetDate) {
    index += 1;
  }
  while (index > 0 && periodStartForIndex(startDate, frequency, index) > targetDate) {
    index -= 1;
  }

  return index;
}

function periodForIndex(startDate: string, frequency: ContributionFrequency, index: number): Period {
  const start = periodStartForIndex(startDate, frequency, index);
  const end = addDaysISO(periodStartForIndex(startDate, frequency, index + 1), -1);
  return { start, end };
}

/** The plan period (start/end, inclusive) that contains `targetDate`. If
 * `targetDate` is before `startDate`, the first period is returned. */
export function getPeriodContaining(
  startDate: string,
  frequency: ContributionFrequency,
  targetDate: string,
): Period {
  const index = getPeriodIndexContaining(startDate, frequency, targetDate);
  return periodForIndex(startDate, frequency, index);
}

/** Every period that overlaps [`fromDate`, `toDate`], inclusive, in
 * chronological order. Used to scan a member's full history for overdue
 * periods, not just the current one. */
export function listPeriodsBetween(
  startDate: string,
  frequency: ContributionFrequency,
  fromDate: string,
  toDate: string,
): Period[] {
  if (toDate < startDate) return [];

  const effectiveFrom = fromDate < startDate ? startDate : fromDate;
  const fromIndex = getPeriodIndexContaining(startDate, frequency, effectiveFrom);
  const toIndex = getPeriodIndexContaining(startDate, frequency, toDate);

  const periods: Period[] = [];
  for (let index = fromIndex; index <= toIndex; index += 1) {
    periods.push(periodForIndex(startDate, frequency, index));
  }
  return periods;
}
