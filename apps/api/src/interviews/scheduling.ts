/**
 * Scheduling arithmetic, kept as pure functions so it can be tested without a database.
 *
 * Times are handled as UTC `Date`s. An organization's working hours and an interviewer's
 * availability are expressed in local wall-clock minutes for a weekday, so converting
 * between the two needs the IANA zone — done with Intl rather than a date library, to
 * avoid pulling in a dependency for this much.
 */

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface WeeklySlot {
  userId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface BusyBlock extends TimeRange {
  userId: string;
  interviewId: string;
}

/** Local wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== "literal") parts[p.type] = p.value;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  // "24" appears at midnight in some ICU versions with hour12:false.
  const hour = Number(parts.hour) % 24;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour,
    minute: Number(parts.minute),
    weekday: weekdayIndex,
    minuteOfDay: hour * 60 + Number(parts.minute),
  };
}

/** The UTC offset of `timeZone` at `date`, in minutes (positive east of UTC). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  // Compare against the instant truncated to the minute to avoid a seconds-level drift.
  const truncated = Math.floor(date.getTime() / 60000) * 60000;
  return (asUtc - truncated) / 60000;
}

/**
 * The UTC instant for a local wall-clock time in `timeZone`.
 * Resolved iteratively because the offset itself depends on the instant (DST).
 */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; minuteOfDay: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(local.year, local.month - 1, local.day, 0, 0, 0, 0) + local.minuteOfDay * 60_000;
  let utc = naive;
  for (let i = 0; i < 3; i++) {
    const offset = offsetMinutes(new Date(utc), timeZone);
    const next = naive - offset * 60_000;
    if (next === utc) break;
    utc = next;
  }
  return new Date(utc);
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  // Touching ends (one ends exactly when the next starts) are not a conflict.
  return a.start < b.end && b.start < a.end;
}

export interface ConflictCheck {
  range: TimeRange;
  userIds: string[];
  busy: BusyBlock[];
  /** Interview being rescheduled - its own blocks are not conflicts. */
  ignoreInterviewId?: string;
}

export interface Conflict {
  userId: string;
  interviewId: string;
  start: Date;
  end: Date;
}

export function findConflicts({ range, userIds, busy, ignoreInterviewId }: ConflictCheck): Conflict[] {
  const wanted = new Set(userIds);
  return busy
    .filter((b) => wanted.has(b.userId) && b.interviewId !== ignoreInterviewId && overlaps(range, b))
    .map((b) => ({ userId: b.userId, interviewId: b.interviewId, start: b.start, end: b.end }));
}

/** True when every listed interviewer has declared availability covering the range. */
export function availabilityGaps(range: TimeRange, userIds: string[], weekly: WeeklySlot[], timeZone: string): string[] {
  const start = zonedParts(range.start, timeZone);
  const end = zonedParts(range.end, timeZone);
  // A slot crossing local midnight can't be expressed as one weekday window.
  const sameLocalDay = start.year === end.year && start.month === end.month && start.day === end.day;

  return userIds.filter((userId) => {
    const slots = weekly.filter((s) => s.userId === userId);
    if (!slots.length) return false; // no declared hours at all: treated as "unknown", not a gap
    if (!sameLocalDay) return true;
    return !slots.some((s) => s.weekday === start.weekday && s.startMinute <= start.minuteOfDay && s.endMinute >= end.minuteOfDay);
  });
}

export interface SlotSearch {
  fromDate: Date;
  toDate: Date;
  durationMinutes: number;
  userIds: string[];
  weekly: WeeklySlot[];
  busy: BusyBlock[];
  timeZone: string;
  /** Step between candidate start times, in minutes. */
  granularityMinutes?: number;
  limit?: number;
  /** Don't suggest anything before this instant (defaults to `fromDate`). */
  notBefore?: Date;
}

/**
 * Free slots where every interviewer is available and none has a conflicting interview.
 * Walks each local day in the window and tests candidate start times inside the
 * intersection of everyone's declared hours.
 */
export function findFreeSlots(search: SlotSearch): TimeRange[] {
  const { fromDate, toDate, durationMinutes, userIds, weekly, busy, timeZone } = search;
  const granularity = search.granularityMinutes ?? 30;
  const limit = search.limit ?? 20;
  const notBefore = search.notBefore ?? fromDate;
  if (!userIds.length || durationMinutes <= 0) return [];

  const results: TimeRange[] = [];
  const dayMs = 24 * 60 * 60 * 1000;

  for (let cursor = fromDate.getTime(); cursor <= toDate.getTime() && results.length < limit; cursor += dayMs) {
    const day = zonedParts(new Date(cursor), timeZone);
    const windows = intersectDay(day.weekday, userIds, weekly);

    for (const window of windows) {
      for (let m = window.start; m + durationMinutes <= window.end && results.length < limit; m += granularity) {
        const start = zonedTimeToUtc({ year: day.year, month: day.month, day: day.day, minuteOfDay: m }, timeZone);
        const end = new Date(start.getTime() + durationMinutes * 60_000);
        if (start < notBefore || end > new Date(toDate.getTime() + dayMs)) continue;
        if (findConflicts({ range: { start, end }, userIds, busy }).length) continue;
        if (results.some((r) => r.start.getTime() === start.getTime())) continue;
        results.push({ start, end });
      }
    }
  }
  return results.sort((a, b) => a.start.getTime() - b.start.getTime()).slice(0, limit);
}

/** Minute windows on `weekday` where every user is available. */
function intersectDay(weekday: number, userIds: string[], weekly: WeeklySlot[]): { start: number; end: number }[] {
  let windows: { start: number; end: number }[] | null = null;

  for (const userId of userIds) {
    const mine = weekly
      .filter((s) => s.userId === userId && s.weekday === weekday)
      .map((s) => ({ start: s.startMinute, end: s.endMinute }))
      .sort((a, b) => a.start - b.start);
    if (!mine.length) return []; // this interviewer has no hours on this weekday
    windows = windows === null ? mine : intersectRanges(windows, mine);
    if (!windows.length) return [];
  }
  return windows ?? [];
}

function intersectRanges(a: { start: number; end: number }[], b: { start: number; end: number }[]) {
  const out: { start: number; end: number }[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

/** Human-readable local time, e.g. "Tue, 25 Nov 2026, 15:00 (Asia/Dhaka)". */
export function formatInZone(date: Date, timeZone: string): string {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${text} (${timeZone})`;
}

/**
 * Minimal RFC 5545 calendar invite. Attached to interview emails so the slot lands in
 * the recipient's calendar without needing a calendar-provider integration.
 */
export function buildIcs(input: {
  uid: string;
  sequence?: number;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  organizerEmail: string;
  organizerName?: string;
  attendeeEmails?: string[];
  cancelled?: boolean;
}): string {
  const stamp = (d: Date) => `${d.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Veyra Talent//Interview//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${input.cancelled ? "CANCEL" : "REQUEST"}`,
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(input.start)}`,
    `DTEND:${stamp(input.end)}`,
    `SUMMARY:${escape(input.title)}`,
    ...(input.description ? [`DESCRIPTION:${escape(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${escape(input.location)}`] : []),
    `ORGANIZER;CN=${escape(input.organizerName ?? "Veyra Talent")}:mailto:${input.organizerEmail}`,
    ...(input.attendeeEmails ?? []).map((e) => `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${e}`),
    `STATUS:${input.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // Fold lines at 75 octets as the spec requires.
  return lines.flatMap((line) => foldLine(line)).join("\r\n");
}

function foldLine(line: string): string[] {
  if (line.length <= 75) return [line];
  const out = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) out.push(` ${line.slice(i, i + 74)}`);
  return out;
}
