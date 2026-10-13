import type { CalendarEvent } from '../../../shared/protocol';

// A week of the 📅 Calendar, laid out the way Google's week view does: Monday to Sunday in this
// browser's timezone, all-day events in a strip along the top, and the rest as blocks down each
// day, side by side where they overlap. The wall board and the window both draw from it.

const DAY_MS = 24 * 3600_000;

/** Local midnight of the Monday of the week `t` is in. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** The local midnights of the 7 days from `start`, and of the day after (days around a clock change aren't 24h). */
export function daysOf(start: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(d.getTime());
  }
  return out;
}

/** An all-day event's key for a local day: the UTC midnight of the same date (see CalendarEvent). */
function dayKey(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

/** An all-day event across the strip: the columns it spans (end exclusive) and its row. */
export interface AllDayBar {
  ev: CalendarEvent;
  from: number;
  to: number;
  row: number;
}

/** A timed event's block in one day's column: minutes from that midnight, and its lane of `lanes`. */
export interface TimedBlock {
  ev: CalendarEvent;
  day: number;
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
  /** It started on an earlier day / goes on into a later one. */
  cutTop: boolean;
  cutBottom: boolean;
}

export interface WeekLayout {
  days: number[];
  allDay: AllDayBar[];
  /** How many rows the all-day strip needs. */
  rows: number;
  timed: TimedBlock[];
  /** The hours the grid shows, first to last (exclusive): working hours, stretched to fit the week's events. */
  hours: [number, number];
}

/** Lays out `events` over the week from `start` (see weekStart). */
export function layoutWeek(events: CalendarEvent[], start: number, workday: [number, number] = [8, 19]): WeekLayout {
  const days = daysOf(start);
  const keys = days.map(dayKey);
  const allDay: AllDayBar[] = [];
  const rowsEnd: number[] = [];
  const perDay: Omit<TimedBlock, 'lane' | 'lanes'>[][] = days.slice(0, 7).map(() => []);
  let [h0, h1] = workday;
  for (const ev of events) {
    if (ev.allDay) {
      const from = keys.findIndex((k, i) => i < 7 && k >= ev.start && k < ev.end);
      if (from < 0) continue;
      let to = from + 1;
      while (to < 7 && keys[to] < ev.end) to++;
      // The first row free from this column on.
      let row = rowsEnd.findIndex((end) => end <= from);
      if (row < 0) row = rowsEnd.length;
      rowsEnd[row] = to;
      allDay.push({ ev, from, to, row });
      continue;
    }
    for (let d = 0; d < 7; d++) {
      const s = Math.max(ev.start, days[d]);
      const e = Math.min(ev.end, days[d + 1]);
      // An event with no length still shows on its day, as a sliver.
      const point = ev.start === ev.end;
      if (point ? ev.start < days[d] || ev.start >= days[d + 1] : e <= s) continue;
      const top = (s - days[d]) / 60_000;
      const bottom = Math.max(top + 15, (e - days[d]) / 60_000);
      const cutTop = ev.start < days[d];
      const cutBottom = ev.end > days[d + 1];
      perDay[d].push({ ev, day: d, top, bottom, cutTop, cutBottom });
      // Stretched to where events start, and end on the day; not to the small hours for one that runs on overnight.
      if (!cutTop) h0 = Math.min(h0, Math.floor(top / 60));
      h1 = Math.max(h1, Math.min(24, cutBottom ? Math.floor(top / 60) + 1 : Math.ceil(bottom / 60)));
    }
  }
  const timed: TimedBlock[] = [];
  for (const blocks of perDay) {
    blocks.sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    // Events that overlap, one after another, share the width: each gets the first lane free.
    let cluster: TimedBlock[] = [];
    let clusterEnd = -1;
    let laneEnds: number[] = [];
    const close = () => {
      for (const b of cluster) b.lanes = laneEnds.length;
      cluster = [];
      laneEnds = [];
    };
    for (const b of blocks) {
      if (b.top >= clusterEnd) close();
      let lane = laneEnds.findIndex((end) => end <= b.top);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = b.bottom;
      clusterEnd = Math.max(clusterEnd, b.bottom);
      const placed = { ...b, lane, lanes: 1 };
      cluster.push(placed);
      timed.push(placed);
    }
    close();
  }
  return { days, allDay, rows: rowsEnd.length, timed, hours: [Math.max(0, h0), Math.min(24, h1)] };
}

/** Which day of the week `t` is, 0 for Monday, or -1 when it isn't in the week of `layout`. */
export function dayIndex(layout: WeekLayout, t: number): number {
  for (let i = 0; i < 7; i++) if (t >= layout.days[i] && t < layout.days[i + 1]) return i;
  return -1;
}

/** Calendar colors, Google's, picked by the event's title so a meeting keeps its color week to week. */
export const EVENT_COLORS = ['#039be5', '#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f4511e', '#0b8043', '#3f51b5', '#d50000', '#616161'];

export function eventColor(ev: CalendarEvent): string {
  let x = 0;
  for (const ch of ev.title) x = (x * 31 + ch.charCodeAt(0)) | 0;
  return EVENT_COLORS[Math.abs(x) % EVENT_COLORS.length];
}

/** "09:30" (or "9:30 AM"), in this browser's way of writing times. */
export function clock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** An hour down the side of the grid: "09 h", "9 AM". */
export function hourLabel(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric' });
}

/** When an event is: "09:30 – 10:00", "All day", or across days. */
export function when(ev: CalendarEvent): string {
  if (ev.allDay) {
    const days = Math.round((ev.end - ev.start) / DAY_MS);
    const first = new Date(ev.start).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
    if (days <= 1) return `${first} · All day`;
    const last = new Date(ev.end - DAY_MS).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
    return `${first} – ${last} · All day`;
  }
  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  if (dayKey(ev.start) === dayKey(ev.end - 1) || ev.end === ev.start) return `${date(ev.start)} · ${clock(ev.start)} – ${clock(ev.end)}`;
  return `${date(ev.start)} ${clock(ev.start)} – ${date(ev.end)} ${clock(ev.end)}`;
}

/** "12 – 18 Oct 2026", the week from `start`. */
export function weekLabel(start: number): string {
  const days = daysOf(start);
  const a = new Date(days[0]);
  const b = new Date(days[6]);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`
    : `${a.getDate()} ${month(a)} – ${b.getDate()} ${month(b)} ${b.getFullYear()}`;
}

/** The next event that hasn't ended, or the one on now. */
export function upNext(events: CalendarEvent[], now: number): CalendarEvent | undefined {
  return events.find((e) => !e.allDay && e.end > now);
}
