import type { CalendarState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The building's 📅 Calendar board. */
    calendar: CalendarState;
  }
  interface Topics {
    calendar: true;
  }
}

export const calendar: Slice = {
  init(s) {
    s.calendar = { configured: false, events: [], from: 0, to: 0, fetchedAt: 0, loading: true };
  },
  on: {
    calendar(s, m) {
      s.calendar = m.state;
      return ['calendar'];
    },
  },
  enter(s, v) {
    s.calendar = v.calendar;
    return ['calendar'];
  },
};
