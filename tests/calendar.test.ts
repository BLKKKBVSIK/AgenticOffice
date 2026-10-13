import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarUrl, parseIcs } from '../src/server/calendar.js';
import { dayIndex, layoutWeek, weekStart } from '../src/client/features/calendar/week.js';

// Shaped like a Google Calendar secret iCal feed: a timezone, a weekly meeting with one occurrence
// moved and one cancelled, a one-off event in UTC, an all-day event and a cancelled event.
const ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-CALNAME:enzo@example.com',
  'X-WR-TIMEZONE:Europe/Paris',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20260901T093000',
  'DTEND;TZID=Europe/Paris:20260901T100000',
  'RRULE:FREQ=WEEKLY;BYDAY=TU',
  'EXDATE;TZID=Europe/Paris:20261020T093000',
  'UID:standup@google.com',
  'SUMMARY:Stand-up',
  'DESCRIPTION:Join: <a href="https://meet.google.com/abc-defg-hij">https://meet.google.com/abc-defg-hij</a><br>Agenda &amp; notes',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261014T110000',
  'DTEND;TZID=Europe/Paris:20261014T113000',
  'RECURRENCE-ID;TZID=Europe/Paris:20261013T093000',
  'UID:standup@google.com',
  'SUMMARY:Stand-up (moved)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261015T130000Z',
  'DTEND:20261015T143000Z',
  'UID:review@google.com',
  'SUMMARY:Design review',
  'LOCATION:Room 2',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261016',
  'DTEND;VALUE=DATE:20261018',
  'UID:offsite@google.com',
  'SUMMARY:Offsite',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261014T080000Z',
  'DTEND:20261014T090000Z',
  'UID:gone@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:Cancelled',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const from = Date.UTC(2026, 9, 12); // Monday 12 October 2026
const to = Date.UTC(2026, 9, 26);

test('a Google feed: occurrences in the window, moves and cancellations as the calendar has them', () => {
  const { name, events } = parseIcs(ICS, from, to);
  assert.equal(name, 'enzo@example.com');
  assert.deepEqual(
    events.map((e) => [e.title, new Date(e.start).toISOString(), e.allDay]),
    [
      // The 13th's stand-up moved to the 14th, the 20th's was cancelled.
      ['Stand-up (moved)', '2026-10-14T09:00:00.000Z', false],
      ['Design review', '2026-10-15T13:00:00.000Z', false],
      ['Offsite', '2026-10-16T00:00:00.000Z', true],
    ],
  );
  const offsite = events.find((e) => e.allDay)!;
  assert.equal(offsite.end - offsite.start, 2 * 24 * 3600_000);
  assert.equal(events.find((e) => e.title === 'Design review')?.location, 'Room 2');
});

test('a recurring event in Paris time keeps its wall-clock time across the change to winter time', () => {
  const { events } = parseIcs(ICS, Date.UTC(2026, 9, 26), Date.UTC(2026, 10, 4));
  const standup = events.find((e) => e.title === 'Stand-up')!;
  // 09:30 in Paris is 08:30 UTC once the clocks go back on 25 October.
  assert.equal(new Date(standup.start).toISOString(), '2026-10-27T08:30:00.000Z');
  assert.equal(standup.call, 'https://meet.google.com/abc-defg-hij');
  assert.match(standup.description ?? '', /Agenda & notes/);
  assert.doesNotMatch(standup.description ?? '', /</);
});

test('the address: webcal is https, anything else that is not a web address is turned away', () => {
  assert.equal(calendarUrl(' webcal://calendar.google.com/calendar/ical/x/private-y/basic.ics '), 'https://calendar.google.com/calendar/ical/x/private-y/basic.ics');
  assert.equal(calendarUrl('https://calendar.google.com/calendar/ical/x/basic.ics'), 'https://calendar.google.com/calendar/ical/x/basic.ics');
  assert.equal(calendarUrl('file:///etc/passwd'), undefined);
  assert.equal(calendarUrl('not a url'), undefined);
});

test('the week grid: Monday first, all-day bars in rows, overlapping events side by side', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const start = weekStart(at(15, 12)); // Thursday 15 October
  assert.equal(start, new Date(2026, 9, 12).getTime());
  const ev = (id: string, s: number, e: number, allDay = false) => ({ id, title: id, start: s, end: e, allDay });
  const week = layoutWeek(
    [
      ev('a', at(13, 9), at(13, 10)),
      ev('b', at(13, 9, 30), at(13, 11)),
      ev('c', at(13, 12), at(13, 13)),
      ev('late', at(14, 21), at(15, 1)),
      ev('offsite', Date.UTC(2026, 9, 16), Date.UTC(2026, 9, 18), true),
      ev('holiday', Date.UTC(2026, 9, 17), Date.UTC(2026, 9, 18), true),
      ev('next week', at(19, 9), at(19, 10)),
    ],
    start,
  );
  const lanes = Object.fromEntries(week.timed.map((b) => [`${b.ev.id}@${b.day}`, [b.lane, b.lanes]]));
  assert.deepEqual(lanes, { 'a@1': [0, 2], 'b@1': [1, 2], 'c@1': [0, 1], 'late@2': [0, 1], 'late@3': [0, 1] });
  assert.deepEqual(week.allDay.map((b) => [b.ev.id, b.from, b.to, b.row]), [['offsite', 4, 6, 0], ['holiday', 5, 6, 1]]);
  assert.equal(week.rows, 2);
  // Stretched past working hours to where the late one starts, not to the small hours it runs on into.
  assert.deepEqual(week.hours, [8, 22]);
  assert.equal(dayIndex(week, at(18, 23)), 6);
  assert.equal(dayIndex(week, at(19, 0)), -1);
});
