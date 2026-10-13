import './ui.css';
import type { CalendarEvent } from '../../../shared/protocol';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, timeAgo } from '../../ui/dom';
import { clock, hourLabel, dayIndex, eventColor, layoutWeek, weekLabel, weekStart, when } from './week';

// The 📅 Calendar's window: the week grid, a week back or on, an event in full, and (for an admin)
// which calendar the building reads.

/** How tall an hour is in the window's grid. */
const HOUR_PX = 48;
const WEEK_MS = 7 * 24 * 3600_000;
const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;

/** Text with its links made clickable. */
function linked(text: string): (string | HTMLElement)[] {
  return text.split(URL_RE).map((part, i) => (i % 2 ? h('a', { href: part, target: '_blank', rel: 'noopener' }, part) : part));
}

function detail(ev: CalendarEvent): HTMLElement {
  return h(
    'aside.cal-detail',
    {},
    h('div.cal-detail-title', {}, h('span.cal-dot', { style: `background:${eventColor(ev)}` }), h('h3', {}, ev.title)),
    h('p.cal-when', {}, when(ev)),
    ev.location ? h('p.cal-where', {}, '📍 ', ...linked(ev.location)) : '',
    ev.call ? h('p', {}, h('a.btn', { href: ev.call, target: '_blank', rel: 'noopener' }, '🎥 Join the call ↗')) : '',
    ev.description ? h('p.cal-desc', {}, ...linked(ev.description)) : '',
  );
}

/** Where to find a Google Calendar's secret address, and the field to paste it in (admins only). */
function setup(net: Net, done: () => void): HTMLElement {
  const st = store.calendar;
  if (!store.me.admin) {
    return h('div.cal-setup', {}, h('p', {}, st.configured ? 'The building’s calendar is set up.' : 'No calendar on the board yet.'), h('p.note', {}, 'Only an admin can choose which calendar the board shows.'));
  }
  const input = h('input', { type: 'password', placeholder: 'https://calendar.google.com/calendar/ical/…/private-…/basic.ics', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const status = h('p.note');
  const save = h('button.btn.primary', { type: 'submit' }, st.configured ? 'Change calendar' : 'Put it on the board');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (url: string) => {
    save.toggleAttribute('disabled', true);
    status.textContent = url ? 'Reading the calendar…' : 'Taking it off…';
    net.send({ t: 'calendar.url', url });
    // A calendar that doesn't read comes back as a warning instead of an update.
    clearTimeout(timer);
    timer = setTimeout(() => {
      save.toggleAttribute('disabled', false);
      status.textContent = '';
    }, 35_000);
    const off = store.on('calendar', () => {
      off();
      clearTimeout(timer);
      done();
    });
  };
  const form = h(
    'form.cal-setup',
    {},
    h(
      'ol',
      {},
      h('li', {}, 'Open ', h('a', { href: 'https://calendar.google.com/calendar/r/settings', target: '_blank', rel: 'noopener' }, 'Google Calendar’s settings ↗'), '.'),
      h('li', {}, 'Under ', h('b', {}, 'Settings for my calendars'), ', pick your calendar, then ', h('b', {}, 'Integrate calendar'), '.'),
      h('li', {}, 'Copy the ', h('b', {}, 'Secret address in iCal format'), ' and paste it here.'),
    ),
    input,
    h('div.cal-setup-actions', {}, save, st.configured ? h('button.btn', { type: 'button', onclick: () => send('') }, 'Take it off the board') : '', st.configured ? h('button.btn', { type: 'button', onclick: done }, 'Cancel') : ''),
    status,
    h('p.note', {}, 'The address stays on the office’s machine. Everyone in the office sees the events on the board, so pick a calendar you’re happy to share with them.'),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = input.value.trim();
    if (url) send(url);
  });
  setTimeout(() => input.focus(), 0);
  return form;
}

export function openCalendar(net: Net) {
  let start = weekStart(Date.now());
  let picked: string | null = null;
  let settingUp = !store.calendar.configured;
  const close = h('button.btn.close', { 'aria-label': 'Close' }, '✕');
  const title = h('h2', {}, '📅 Calendar');
  const nav = h('div.cal-nav');
  const body = h('div.body.cal-body');
  const footer = h('footer', {}, h('span.grow'));
  const el = h('div.modal.cal-modal', { role: 'dialog', 'aria-label': 'Calendar' }, h('header', {}, title, nav, close), body, footer);

  const render = () => {
    const st = store.calendar;
    title.replaceChildren('📅 Calendar', st.name ? h('small', {}, ` · ${st.name}`) : '');
    footer.firstElementChild!.textContent = st.error
      ? `⚠️ ${st.error}`
      : st.fetchedAt
        ? `Read from Google ${timeAgo(st.fetchedAt)}${st.loading ? ' · reading again…' : ''}`
        : st.loading
          ? 'Reading the calendar…'
          : '';
    if (settingUp || !st.configured) {
      nav.replaceChildren();
      body.replaceChildren(
        setup(net, () => {
          settingUp = false;
          render();
        }),
      );
      return;
    }
    const canBack = start > st.from;
    const canOn = start + WEEK_MS < st.to;
    nav.replaceChildren(
      h('button.btn', { type: 'button', title: 'The week before', disabled: !canBack, onclick: () => ((start = weekStart(start - 1)), render()) }, '◀'),
      h('button.btn', { type: 'button', onclick: () => ((start = weekStart(Date.now())), render()) }, 'Today'),
      h('button.btn', { type: 'button', title: 'The week after', disabled: !canOn, onclick: () => ((start = weekStart(start + WEEK_MS + 3600_000)), render()) }, '▶'),
      h('span.cal-week-label', {}, weekLabel(start)),
      h('button.btn', { type: 'button', title: 'Read the calendar again', onclick: () => net.send({ t: 'calendar.refresh' }) }, '🔄'),
      store.me.admin ? h('button.btn', { type: 'button', title: 'Which calendar the board shows', onclick: () => ((settingUp = true), render()) }, '⚙️') : '',
    );
    const now = Date.now();
    const week = layoutWeek(st.events, start, [0, 24]);
    const today = dayIndex(week, now);
    const col = (d: number) => `left:calc(${d} * (100% / 7));width:calc(100% / 7)`;
    const heads = week.days.slice(0, 7).map((t, d) => {
      const date = new Date(t);
      return h('div.cal-head', { class: d === today ? 'today' : '' }, h('small', {}, date.toLocaleDateString(undefined, { weekday: 'short' })), h('b', {}, String(date.getDate())));
    });
    const strip = h('div.cal-strip', { style: `height:${Math.max(1, week.rows) * 26 + 6}px` });
    for (const bar of week.allDay) {
      strip.append(
        h(
          'button.cal-bar',
          {
            type: 'button',
            class: bar.ev.id === picked ? 'on' : '',
            style: `left:calc(${bar.from} * (100% / 7) + 2px);width:calc(${bar.to - bar.from} * (100% / 7) - 4px);top:${bar.row * 26 + 3}px;background:${eventColor(bar.ev)}`,
            title: bar.ev.title,
            onclick: () => ((picked = bar.ev.id), render()),
          },
          bar.ev.title,
        ),
      );
    }
    const hours = h('div.cal-hours', { style: `height:${24 * HOUR_PX}px` });
    const lanes = h('div.cal-cols');
    for (let d = 0; d < 7; d++) lanes.append(h('div.cal-col', { class: d === today ? 'today' : '', style: col(d) }));
    for (let hr = 1; hr < 24; hr++) hours.append(h('span.cal-hour', { style: `top:${hr * HOUR_PX}px` }, hourLabel(new Date(start).setHours(hr, 0, 0, 0))));
    for (const b of week.timed) {
      const short = b.bottom - b.top < 45;
      lanes.append(
        h(
          'button.cal-ev',
          {
            type: 'button',
            class: [b.ev.id === picked ? 'on' : '', b.ev.end <= now ? 'past' : '', short ? 'short' : ''].filter(Boolean).join(' '),
            style: `left:calc(${b.day} * (100% / 7) + ${b.lane} * (100% / 7 - 6px) / ${b.lanes} + 2px);width:calc((100% / 7 - 6px) / ${b.lanes} - 2px);top:${(b.top / 60) * HOUR_PX}px;height:${Math.max(18, ((b.bottom - b.top) / 60) * HOUR_PX - 2)}px;background:${eventColor(b.ev)}`,
            title: `${b.ev.title}\n${when(b.ev)}`,
            onclick: () => ((picked = b.ev.id), render()),
          },
          h('b', {}, b.ev.title),
          short ? '' : h('small', {}, `${clock(b.ev.start)} – ${clock(b.ev.end)}`),
        ),
      );
    }
    if (today >= 0) lanes.append(h('div.cal-now', { style: `${col(today)};top:${((now - week.days[today]) / 3600_000) * HOUR_PX}px` }));
    const scroller = h('div.cal-scroll', {}, hours, lanes);
    const ev = st.events.find((e) => e.id === picked);
    body.replaceChildren(
      h('div.cal-main', {}, h('div.cal-heads', {}, h('span'), ...heads), h('div.cal-strip-row', {}, h('span'), strip), h('div.cal-scroll-wrap', {}, scroller)),
      ev ? detail(ev) : h('aside.cal-detail.empty', {}, st.events.length ? 'Click an event to read it in full.' : 'Nothing on the calendar these weeks.'),
    );
    // Open on the time it is now (or the start of the working day); after that, the grid stays where it was scrolled to.
    const at = lastScroll ?? Math.max(0, (today >= 0 ? new Date(now).getHours() - 2 : 8) * HOUR_PX);
    requestAnimationFrame(() => (scroller.scrollTop = at));
  };

  let lastScroll: number | undefined;
  body.addEventListener(
    'scroll',
    (e) => {
      const t = e.target as HTMLElement;
      if (t.classList?.contains('cal-scroll')) lastScroll = t.scrollTop;
    },
    true,
  );

  const off = store.on('calendar', () => {
    if (!settingUp) render();
  });
  // Keeps the line at now, and "read 5m ago", moving.
  const tick = setInterval(() => {
    if (!settingUp) render();
  }, 60_000);
  const modal = openModal(el, {
    doing: '📅 at the calendar',
    onClose: () => {
      off();
      clearInterval(tick);
    },
  });
  close.addEventListener('click', () => modal.close());
  if (store.calendar.configured && Date.now() - store.calendar.fetchedAt > 5 * 60_000) net.send({ t: 'calendar.refresh' });
  render();
}
