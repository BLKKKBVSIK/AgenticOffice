import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ICAL from 'ical.js';
import type { CalendarEvent, CalendarState } from '../shared/protocol.js';

// The 📅 Calendar board: one Google Calendar for the whole building, read from the calendar's
// secret iCal address (Google Calendar → Settings → the calendar → "Secret address in iCal
// format"). No Google sign-in: the address is the key, so it's kept in <office>/calendar.json, only
// readable by the office, and never sent to a browser.

const DAY_MS = 24 * 3600_000;
/** The events sent cover this long before now and after it: last week, this one and the next four, in any timezone. */
const BEFORE_MS = 8 * DAY_MS;
const AFTER_MS = 36 * DAY_MS;
/** The most events sent, soonest first. */
const MAX_EVENTS = 800;
/** A recurring event is followed this many times at most, from its first, looking for the window. */
const MAX_STEPS = 20_000;
/** How often the calendar is read while anyone's in the building, and otherwise. */
const REFRESH_MS = 5 * 60_000;
const IDLE_REFRESH_MS = 30 * 60_000;
/** How soon a read that failed is tried again, while anyone's in the building. */
const RETRY_MS = 60_000;
const FETCH_TIMEOUT_MS = 30_000;
const DESCRIPTION_MAX = 1500;

/** A video call link in an event's text. */
const CALL_RE = /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[\w.-]*zoom\.us\/j\/[^\s"'<>]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>]+|teams\.live\.com\/meet\/[^\s"'<>]+)/i;

/** The address as the office fetches it (webcal:// is https), or undefined when it isn't a web address. */
export function calendarUrl(raw: string): string | undefined {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://');
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Google's descriptions are HTML at times: as plain text, cut short. */
function plainText(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const text = s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href: string, label: string) => (label.includes(href) || href.startsWith('mailto:') ? label : `${label} (${href})`))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return undefined;
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX)}…` : text;
}

/** A time as ms; a date (an all-day event's) as its UTC midnight. */
function ms(t: ICAL.Time): number {
  return t.isDate ? Date.UTC(t.year, t.month - 1, t.day) : t.toJSDate().getTime();
}

function occurrence(e: ICAL.Event, start: ICAL.Time, end: ICAL.Time): CalendarEvent {
  const s = ms(start);
  const allDay = start.isDate;
  // An all-day event with no end lasts its one day.
  const en = Math.max(ms(end), allDay ? s + DAY_MS : s);
  const description = plainText(e.description);
  const conference = e.component.getFirstPropertyValue('x-google-conference');
  const call = (typeof conference === 'string' && conference) || `${e.location ?? ''} ${e.description ?? ''}`.match(CALL_RE)?.[0];
  return {
    id: `${e.uid}|${s}`,
    title: (e.summary || '(No title)').trim().slice(0, 300),
    start: s,
    end: en,
    allDay,
    ...(e.location ? { location: e.location.trim().slice(0, 300) } : {}),
    ...(description ? { description } : {}),
    ...(call ? { call } : {}),
  };
}

function cancelled(e: ICAL.Event): boolean {
  return String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

/**
 * The events of an iCalendar file that overlap `from`..`to` (ms), each time a recurring one happens
 * as an event of its own, soonest first. Moved or cancelled occurrences are as the calendar has them.
 */
export function parseIcs(text: string, from: number, to: number): { name?: string; events: CalendarEvent[] } {
  const cal = new ICAL.Component(ICAL.parse(text));
  // Google names each timezone its events use and describes it in the file.
  for (const tz of cal.getAllSubcomponents('vtimezone')) {
    const id = tz.getFirstPropertyValue('tzid');
    if (typeof id === 'string' && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
  }
  const masters = new Map<string, ICAL.Event>();
  const moved: ICAL.Event[] = [];
  for (const c of cal.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(c);
    if (e.isRecurrenceException()) moved.push(e);
    else masters.set(e.uid, e);
  }
  for (const x of moved) masters.get(x.uid)?.relateException(x);
  const out: CalendarEvent[] = [];
  const keep = (e: ICAL.Event, start: ICAL.Time, end: ICAL.Time) => {
    const ev = occurrence(e, start, end);
    if (ev.end > from && ev.start < to) out.push(ev);
  };
  for (const e of masters.values()) {
    if (cancelled(e) || !e.startDate) continue;
    if (!e.isRecurring()) {
      keep(e, e.startDate, e.endDate);
      continue;
    }
    const it = e.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_STEPS; i++, next = it.next()) {
      if (ms(next) >= to) break;
      const d = e.getOccurrenceDetails(next);
      // A moved or cancelled occurrence is its own event, below.
      if (d.item !== e) continue;
      keep(e, d.startDate, d.endDate);
    }
  }
  // Moved occurrences, where they were moved to (which may be into the window from outside it).
  for (const x of moved) if (!cancelled(x) && x.startDate) keep(x, x.startDate, x.endDate);
  out.sort((a, b) => a.start - b.start || b.end - a.end || a.title.localeCompare(b.title));
  const name = cal.getFirstPropertyValue('x-wr-calname');
  return { ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}), events: out.slice(0, MAX_EVENTS) };
}

/** Reads the calendar at `url`: its text, or why it couldn't. */
async function download(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'text/calendar, */*' } });
  } catch (err) {
    const e = err as Error;
    throw new Error(e.name === 'TimeoutError' ? `The calendar took more than ${FETCH_TIMEOUT_MS / 1000}s to answer` : `Couldn't reach the calendar: ${e.message}`);
  }
  // Google answers a wrong or reset secret address with a 404.
  if (res.status === 404 || res.status === 403 || res.status === 401) throw new Error("Google doesn't know that address (was the secret address reset?) — paste the calendar's secret address in iCal format again");
  if (!res.ok) throw new Error(`The calendar answered ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That address doesn't give a calendar — use the secret address in iCal format (it ends in .ics)");
  return text;
}

interface Saved {
  url?: string;
}

/** The building's calendar: where it is (saved in <office>/calendar.json) and its events. */
export class Calendar {
  private url?: string;
  private name?: string;
  private events: CalendarEvent[] = [];
  private window = { from: 0, to: 0 };
  private fetchedAt = 0;
  private loading = false;
  private error?: string;
  private file: string;
  /** Bumped when the address changes, so a read of the old one doesn't land. */
  private generation = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    dataDir: string,
    /** The events changed: everyone gets the board again. */
    private onChange: () => void,
  ) {
    this.file = path.join(dataDir, 'calendar.json');
    try {
      if (existsSync(this.file)) this.url = calendarUrl((JSON.parse(readFileSync(this.file, 'utf8')) as Saved).url ?? '');
    } catch (err) {
      console.error(`agent-office: ${this.file} couldn't be read: ${(err as Error).message}`);
    }
  }

  /** Reads now, then keeps the events fresh while `busy` (anyone's in the building), and now and then otherwise. */
  start(busy: () => boolean) {
    void this.refresh();
    this.timer = setInterval(() => {
      if (!this.url || this.loading) return;
      const due = busy() ? (this.error ? RETRY_MS : REFRESH_MS) : IDLE_REFRESH_MS;
      if (Date.now() - this.fetchedAt > due) void this.refresh();
    }, RETRY_MS / 2);
  }

  stop() {
    clearInterval(this.timer);
  }

  view(): CalendarState {
    return {
      configured: !!this.url,
      ...(this.name ? { name: this.name } : {}),
      events: this.events,
      from: this.window.from,
      to: this.window.to,
      fetchedAt: this.fetchedAt,
      loading: this.loading,
      ...(this.error ? { error: this.error } : {}),
    };
  }

  async refresh(): Promise<void> {
    const url = this.url;
    if (!url || this.loading) return;
    const gen = this.generation;
    this.loading = true;
    this.onChange();
    try {
      const text = await download(url);
      const now = Date.now();
      const from = now - BEFORE_MS;
      const to = now + AFTER_MS;
      const { name, events } = parseIcs(text, from, to);
      if (gen !== this.generation) return;
      this.name = name;
      this.events = events;
      this.window = { from, to };
      this.error = undefined;
    } catch (err) {
      if (gen !== this.generation) return;
      this.error = (err as Error).message;
    } finally {
      if (gen === this.generation) {
        this.loading = false;
        this.fetchedAt = Date.now();
        this.onChange();
      }
    }
  }

  /** Points the building at the calendar at `raw` once it reads, or takes it off (''). Returns why not, if it didn't. */
  async setUrl(raw: string): Promise<string | undefined> {
    let url: string | undefined;
    let first: { name?: string; events: CalendarEvent[]; from: number; to: number } | undefined;
    if (raw.trim()) {
      url = calendarUrl(raw);
      if (!url) return "That isn't a web address — paste the calendar's secret address in iCal format";
      try {
        const now = Date.now();
        first = { ...parseIcs(await download(url), now - BEFORE_MS, now + AFTER_MS), from: now - BEFORE_MS, to: now + AFTER_MS };
      } catch (err) {
        return (err as Error).message;
      }
    }
    try {
      writeFileSync(this.file, `${JSON.stringify({ url } satisfies Saved, null, 2)}\n`, { mode: 0o600 });
      chmodSync(this.file, 0o600);
    } catch (err) {
      return `Couldn't save the calendar: ${(err as Error).message}`;
    }
    this.generation++;
    this.url = url;
    this.name = first?.name;
    this.events = first?.events ?? [];
    this.window = first ? { from: first.from, to: first.to } : { from: 0, to: 0 };
    this.fetchedAt = first ? Date.now() : 0;
    this.loading = false;
    this.error = undefined;
    this.onChange();
    return undefined;
  }
}
