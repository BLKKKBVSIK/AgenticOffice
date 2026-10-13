// The 📅 Calendar board: one Google Calendar for the whole building, read from its secret iCal
// address. The address itself stays on the server: browsers only ever get the events.

/** One occurrence of an event (a recurring event has one per time it happens). */
export interface CalendarEvent {
  /** The event's UID and when this occurrence starts, so each occurrence has its own. */
  id: string;
  title: string;
  /**
   * When it starts and ends (end exclusive), in ms. For an all-day event these are the UTC
   * midnights of its first day and of the day after its last, so read them with getUTC*.
   */
  start: number;
  end: number;
  allDay: boolean;
  location?: string;
  /** Its description as plain text, cut short. */
  description?: string;
  /** A video call link from the event (Google Meet, Zoom, Teams), when it has one. */
  call?: string;
}

export interface CalendarState {
  /** Whether the building has a calendar to read. */
  configured: boolean;
  /** The calendar's name, as Google gives it. */
  name?: string;
  /** The events from `from` to `to` (ms), soonest first. */
  events: CalendarEvent[];
  from: number;
  to: number;
  fetchedAt: number;
  loading: boolean;
  error?: string;
}

export type CalendarClientMsg =
  | { t: 'calendar.refresh' }
  /** An admin points the building at a calendar's secret iCal address; '' takes it off. */
  | { t: 'calendar.url'; url: string };

export type CalendarServerMsg = { t: 'calendar'; state: CalendarState };
