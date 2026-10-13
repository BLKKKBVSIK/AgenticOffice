/**
 * The 📅 Calendar board: the building's Google Calendar, a week at a time. It hangs on the east
 * wall where the services board did (see features/boards), and opens its window; the services are
 * still in the ☰ menu.
 */
import type { Ctx } from '../../core/context';
import { boardHint } from '../../core/hint';
import { store } from '../../state';
import { openCalendar } from './ui';
import { clock, upNext } from './week';
import { CalendarBoardTexture } from './world';

export function installCalendar(ctx: Ctx) {
  const tex = new CalendarBoardTexture();
  const render = () => tex.render(store.calendar);
  // The line at now moves down the board.
  setInterval(render, 30_000);
  const open = () => openCalendar(ctx.net);
  return {
    /** The board, for features/boards to hang on the wall. */
    board: {
      texture: tex.texture,
      render,
      hint: () => {
        const now = Date.now();
        const next = upNext(store.calendar.events, now);
        if (!next) return boardHint('📅 Calendar');
        const today = new Date(next.start).toDateString() === new Date(now).toDateString();
        const at = today ? clock(next.start) : `${new Date(next.start).toLocaleDateString(undefined, { weekday: 'short' })} ${clock(next.start)}`;
        return boardHint(`📅 ${next.start <= now ? 'Now' : `Next, ${at}`}: ${next.title}`);
      },
      open,
    },
    open,
  };
}
