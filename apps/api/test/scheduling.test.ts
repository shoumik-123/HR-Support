import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  availabilityGaps,
  buildIcs,
  findConflicts,
  findFreeSlots,
  formatInZone,
  offsetMinutes,
  overlaps,
  zonedParts,
  zonedTimeToUtc,
} from "../src/interviews/scheduling";

const DHAKA = "Asia/Dhaka"; // UTC+6, no DST
const NY = "America/New_York"; // UTC-5 / -4 with DST

describe("timezone conversion", () => {
  it("reads local wall-clock parts in a zone", () => {
    // 2026-11-25T09:00Z is 15:00 in Dhaka (UTC+6)
    const p = zonedParts(new Date("2026-11-25T09:00:00Z"), DHAKA);
    assert.equal(p.hour, 15);
    assert.equal(p.minuteOfDay, 15 * 60);
    assert.equal(p.weekday, 3); // Wednesday
    assert.equal(p.day, 25);
  });

  it("reports the UTC offset, including DST", () => {
    assert.equal(offsetMinutes(new Date("2026-11-25T09:00:00Z"), DHAKA), 360);
    assert.equal(offsetMinutes(new Date("2026-01-15T12:00:00Z"), NY), -300); // EST
    assert.equal(offsetMinutes(new Date("2026-07-15T12:00:00Z"), NY), -240); // EDT
  });

  it("converts a local wall-clock time to the right UTC instant", () => {
    const utc = zonedTimeToUtc({ year: 2026, month: 11, day: 25, minuteOfDay: 15 * 60 }, DHAKA);
    assert.equal(utc.toISOString(), "2026-11-25T09:00:00.000Z");
  });

  it("round-trips across a DST boundary", () => {
    // 10:00 local on both sides of the US spring-forward date
    const winter = zonedTimeToUtc({ year: 2026, month: 1, day: 15, minuteOfDay: 600 }, NY);
    const summer = zonedTimeToUtc({ year: 2026, month: 7, day: 15, minuteOfDay: 600 }, NY);
    assert.equal(winter.toISOString(), "2026-01-15T15:00:00.000Z");
    assert.equal(summer.toISOString(), "2026-07-15T14:00:00.000Z");
    assert.equal(zonedParts(winter, NY).minuteOfDay, 600);
    assert.equal(zonedParts(summer, NY).minuteOfDay, 600);
  });

  it("handles midnight without rolling the hour to 24", () => {
    const midnight = zonedTimeToUtc({ year: 2026, month: 11, day: 25, minuteOfDay: 0 }, DHAKA);
    const p = zonedParts(midnight, DHAKA);
    assert.equal(p.hour, 0);
    assert.equal(p.minuteOfDay, 0);
    assert.equal(p.day, 25);
  });

  it("formats a readable local time with the zone named", () => {
    const text = formatInZone(new Date("2026-11-25T09:00:00Z"), DHAKA);
    assert.match(text, /15:00/);
    assert.match(text, /Asia\/Dhaka/);
  });
});

describe("overlap and conflicts", () => {
  const r = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });

  it("detects a genuine overlap", () => {
    assert.equal(overlaps(r("2026-11-25T09:00Z", "2026-11-25T10:00Z"), r("2026-11-25T09:30Z", "2026-11-25T10:30Z")), true);
  });

  it("treats back-to-back interviews as free", () => {
    assert.equal(overlaps(r("2026-11-25T09:00Z", "2026-11-25T10:00Z"), r("2026-11-25T10:00Z", "2026-11-25T11:00Z")), false);
  });

  const busy = [
    { userId: "u1", interviewId: "i1", ...r("2026-11-25T09:00Z", "2026-11-25T10:00Z") },
    { userId: "u2", interviewId: "i2", ...r("2026-11-25T14:00Z", "2026-11-25T15:00Z") },
  ];

  it("flags only the interviewers who are actually busy", () => {
    const conflicts = findConflicts({ range: r("2026-11-25T09:30Z", "2026-11-25T10:30Z"), userIds: ["u1", "u2"], busy });
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].userId, "u1");
  });

  it("ignores interviewers who are not invited", () => {
    const conflicts = findConflicts({ range: r("2026-11-25T14:30Z", "2026-11-25T15:30Z"), userIds: ["u1"], busy });
    assert.equal(conflicts.length, 0);
  });

  it("does not treat the interview being rescheduled as its own conflict", () => {
    const conflicts = findConflicts({ range: r("2026-11-25T09:15Z", "2026-11-25T10:15Z"), userIds: ["u1"], busy, ignoreInterviewId: "i1" });
    assert.equal(conflicts.length, 0);
  });
});

describe("availability", () => {
  // Wednesday 10:00-17:00 Dhaka for u1; u2 only until 12:00
  const weekly = [
    { userId: "u1", weekday: 3, startMinute: 600, endMinute: 1020 },
    { userId: "u2", weekday: 3, startMinute: 600, endMinute: 720 },
  ];

  it("passes when everyone's declared hours cover the slot", () => {
    // 15:00-16:00 Dhaka Wednesday
    const range = { start: new Date("2026-11-25T09:00:00Z"), end: new Date("2026-11-25T10:00:00Z") };
    assert.deepEqual(availabilityGaps(range, ["u1"], weekly, DHAKA), []);
  });

  it("names the interviewer whose hours do not cover the slot", () => {
    const range = { start: new Date("2026-11-25T09:00:00Z"), end: new Date("2026-11-25T10:00:00Z") };
    assert.deepEqual(availabilityGaps(range, ["u1", "u2"], weekly, DHAKA), ["u2"]);
  });

  it("treats an interviewer with no declared hours as unknown, not unavailable", () => {
    const range = { start: new Date("2026-11-25T09:00:00Z"), end: new Date("2026-11-25T10:00:00Z") };
    assert.deepEqual(availabilityGaps(range, ["u3"], weekly, DHAKA), []);
  });

  it("flags a slot on the wrong weekday", () => {
    // Thursday
    const range = { start: new Date("2026-11-26T09:00:00Z"), end: new Date("2026-11-26T10:00:00Z") };
    assert.deepEqual(availabilityGaps(range, ["u1"], weekly, DHAKA), ["u1"]);
  });
});

describe("findFreeSlots", () => {
  const weekly = [
    { userId: "u1", weekday: 3, startMinute: 600, endMinute: 780 }, // Wed 10:00-13:00
    { userId: "u2", weekday: 3, startMinute: 660, endMinute: 780 }, // Wed 11:00-13:00
  ];
  const from = new Date("2026-11-25T00:00:00Z"); // Wednesday
  const to = new Date("2026-11-25T23:59:00Z");

  it("suggests slots inside the intersection of everyone's hours", () => {
    const slots = findFreeSlots({ fromDate: from, toDate: to, durationMinutes: 60, userIds: ["u1", "u2"], weekly, busy: [], timeZone: DHAKA, notBefore: from });
    assert.ok(slots.length > 0);
    // Intersection is 11:00-13:00 Dhaka = 05:00-07:00 UTC
    assert.equal(slots[0].start.toISOString(), "2026-11-25T05:00:00.000Z");
    assert.ok(slots.every((s) => s.start >= new Date("2026-11-25T05:00:00Z") && s.end <= new Date("2026-11-25T07:00:00Z")));
  });

  it("returns nothing when hours do not intersect", () => {
    const disjoint = [
      { userId: "u1", weekday: 3, startMinute: 600, endMinute: 660 },
      { userId: "u2", weekday: 3, startMinute: 700, endMinute: 780 },
    ];
    assert.deepEqual(findFreeSlots({ fromDate: from, toDate: to, durationMinutes: 30, userIds: ["u1", "u2"], weekly: disjoint, busy: [], timeZone: DHAKA, notBefore: from }), []);
  });

  it("skips slots that clash with an existing interview", () => {
    const busy = [{ userId: "u1", interviewId: "i1", start: new Date("2026-11-25T05:00:00Z"), end: new Date("2026-11-25T06:00:00Z") }];
    const slots = findFreeSlots({ fromDate: from, toDate: to, durationMinutes: 60, userIds: ["u1", "u2"], weekly, busy, timeZone: DHAKA, notBefore: from });
    assert.ok(slots.every((s) => s.start.toISOString() !== "2026-11-25T05:00:00.000Z"), "busy slot was suggested");
    assert.equal(slots[0].start.toISOString(), "2026-11-25T06:00:00.000Z");
  });

  it("never suggests a slot in the past", () => {
    const notBefore = new Date("2026-11-25T06:00:00Z");
    const slots = findFreeSlots({ fromDate: from, toDate: to, durationMinutes: 60, userIds: ["u1", "u2"], weekly, busy: [], timeZone: DHAKA, notBefore });
    assert.ok(slots.every((s) => s.start >= notBefore));
  });

  it("does not suggest a slot longer than the window allows", () => {
    const slots = findFreeSlots({ fromDate: from, toDate: to, durationMinutes: 180, userIds: ["u1", "u2"], weekly, busy: [], timeZone: DHAKA, notBefore: from });
    assert.equal(slots.length, 0, "a 3h slot cannot fit a 2h intersection");
  });

  it("respects the requested limit", () => {
    const slots = findFreeSlots({ fromDate: from, toDate: to, durationMinutes: 30, userIds: ["u1"], weekly, busy: [], timeZone: DHAKA, notBefore: from, limit: 2 });
    assert.equal(slots.length, 2);
  });
});

describe("buildIcs", () => {
  const ics = buildIcs({
    uid: "interview-1@veyra",
    title: "Technical Interview: Senior Engineer",
    description: "Round 1 with the platform team",
    location: "https://meet.example.com/abc",
    start: new Date("2026-11-25T09:00:00Z"),
    end: new Date("2026-11-25T10:00:00Z"),
    organizerEmail: "hr@veyra.test",
    attendeeEmails: ["candidate@example.com"],
  });

  it("produces a valid calendar envelope", () => {
    assert.match(ics, /^BEGIN:VCALENDAR/);
    assert.match(ics, /END:VCALENDAR$/);
    assert.match(ics, /METHOD:REQUEST/);
    assert.match(ics, /STATUS:CONFIRMED/);
  });

  it("uses UTC timestamps", () => {
    assert.match(ics, /DTSTART:20261125T090000Z/);
    assert.match(ics, /DTEND:20261125T100000Z/);
  });

  it("includes organizer and attendees", () => {
    assert.match(ics, /ORGANIZER;CN=[^:]*:mailto:hr@veyra\.test/);
    assert.match(ics, /ATTENDEE[^:]*:mailto:candidate@example\.com/);
  });

  it("marks a cancellation", () => {
    const cancelled = buildIcs({
      uid: "interview-1@veyra", sequence: 1, title: "x", start: new Date(), end: new Date(),
      organizerEmail: "hr@veyra.test", cancelled: true,
    });
    assert.match(cancelled, /METHOD:CANCEL/);
    assert.match(cancelled, /STATUS:CANCELLED/);
    assert.match(cancelled, /SEQUENCE:1/);
  });

  it("escapes commas and folds long lines to 75 octets", () => {
    const long = buildIcs({
      uid: "u", title: "A very long interview title that definitely exceeds the seventy five octet limit, with a comma",
      start: new Date(), end: new Date(), organizerEmail: "a@b.test",
    });
    assert.match(long, /limit\\,/, "comma should be escaped");
    assert.ok(long.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "a line exceeded 75 octets");
  });
});
