// The 📅 Calendar board: reading it again, and pointing the building at a calendar (admins only:
// its secret address lets anyone who has it read the whole calendar).
import type { CalendarClientMsg } from '../../../shared/protocol.js';
import { str } from '../../office/input.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const calendarView: ViewPieces['calendar'] = (ctx) => ctx.calendar.view();

export const calendarHandlers = {
  'calendar.refresh'(ctx) {
    void ctx.calendar.refresh();
  },
  'calendar.url'(ctx, c, msg) {
    const who = c.peer.name;
    if (!ctx.meOf(c.accountId).admin) return ctx.warn(c, 'Only admins can change the building’s calendar');
    const url = str(msg.url, 4096).trim();
    void ctx.calendar.setUrl(url).then((error) => {
      if (error) return ctx.warn(c, error);
      // Not the address: it's the calendar's key.
      console.log(`  ${who} ${url ? `set the calendar board to ${ctx.calendar.view().name ?? 'a calendar'}` : 'took the calendar off the board'}`);
      ctx.toastAll(url ? `📅 ${who} put ${ctx.calendar.view().name ?? 'a calendar'} on the calendar board` : `📅 ${who} took the calendar off the board`);
    });
  },
} satisfies HandlerMap<CalendarClientMsg>;
