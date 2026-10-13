import * as THREE from 'three';
import type { CalendarState } from '../../../shared/protocol';
import { clip, wrap } from '../boards/world';
import { clock, hourLabel, dayIndex, eventColor, layoutWeek, upNext, weekLabel, weekStart } from './week';

// The 📅 Calendar board on the east wall, where the services board was: this week of the building's
// Google Calendar as a week grid, today's column picked out and a red line at the time it is now.

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const INK = '#2b2d42';
const MUTED = '#6c6f80';
const LINE = '#e3ded3';
const NOW = '#ea4335';

/** The calendar board, drawn onto a canvas (2:1, like the other wall boards). */
export class CalendarBoardTexture {
  readonly texture: THREE.CanvasTexture;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private drawn = '';

  constructor() {
    this.canvas.width = 1600;
    this.canvas.height = 800;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  render(state: CalendarState, now = Date.now()) {
    // Redrawn each minute for the line at now, and whenever the events change.
    const key = `${Math.floor(now / 60_000)}|${state.fetchedAt}|${state.loading}|${state.configured}|${state.error ?? ''}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const g = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.fillStyle = '#fffdf8';
    g.fillRect(0, 0, W, H);
    const message = !state.configured
      ? 'Press E to put a Google Calendar on this board'
      : state.error && !state.fetchedAt
        ? `⚠️ ${state.error}`
        : state.loading && !state.fetchedAt
          ? 'Loading the calendar…'
          : '';
    if (message) {
      g.fillStyle = INK;
      g.font = `800 56px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('📅', W / 2, H / 2 - 90);
      g.font = `800 44px ${FONT}`;
      wrap(g, message, W - 240, 4).forEach((line, i, all) => g.fillText(line, W / 2, H / 2 + (i - (all.length - 1) / 2) * 56));
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      this.texture.needsUpdate = true;
      return;
    }

    const start = weekStart(now);
    const week = layoutWeek(state.events, start);
    const today = dayIndex(week, now);
    const gutter = 92;
    const headH = 92;
    const rowH = 34;
    const shownRows = Math.min(week.rows, 3);
    const stripH = shownRows ? shownRows * rowH + 10 : 0;
    const gridTop = headH + stripH;
    const colW = (W - gutter) / 7;
    const [h0, h1] = week.hours;
    const hourH = (H - gridTop - 8) / (h1 - h0);
    const yOf = (min: number) => gridTop + ((min - h0 * 60) / 60) * hourH;

    // Today's column, and the week's days along the top.
    if (today >= 0) {
      g.fillStyle = '#eef4ff';
      g.fillRect(gutter + today * colW, 0, colW, H);
    }
    g.fillStyle = MUTED;
    g.font = `800 20px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(weekLabel(start).replace(/ \d{4}$/, ''), gutter / 2, 36, gutter - 8);
    for (let d = 0; d < 7; d++) {
      const date = new Date(week.days[d]);
      const x = gutter + d * colW + colW / 2;
      g.fillStyle = d === today ? '#1a73e8' : MUTED;
      g.font = `800 22px ${FONT}`;
      g.fillText(date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(), x, 32);
      if (d === today) {
        g.beginPath();
        g.arc(x, 64, 24, 0, Math.PI * 2);
        g.fillStyle = '#1a73e8';
        g.fill();
      }
      g.fillStyle = d === today ? '#fff' : INK;
      g.font = `900 30px ${FONT}`;
      g.fillText(String(date.getDate()), x, 75);
    }

    // The grid: a line each hour, and between the days.
    g.strokeStyle = LINE;
    g.lineWidth = 2;
    g.textAlign = 'right';
    g.font = `700 18px ${FONT}`;
    for (let h = h0; h <= h1; h++) {
      const y = yOf(h * 60);
      g.beginPath();
      g.moveTo(gutter - 6, y);
      g.lineTo(W, y);
      g.stroke();
      if (h < h1) {
        g.fillStyle = MUTED;
        g.fillText(hourLabel(new Date(start).setHours(h, 0, 0, 0)), gutter - 12, y + 18);
      }
    }
    for (let d = 0; d <= 7; d++) {
      g.beginPath();
      g.moveTo(gutter + d * colW, headH - 6);
      g.lineTo(gutter + d * colW, H);
      g.stroke();
    }

    // All-day events, in a strip under the dates.
    g.textAlign = 'left';
    for (const bar of week.allDay) {
      if (bar.row >= shownRows) continue;
      const x = gutter + bar.from * colW + 4;
      const y = headH + bar.row * rowH + 2;
      const w = (bar.to - bar.from) * colW - 8;
      roundRect(g, x, y, w, rowH - 6, 6);
      g.fillStyle = eventColor(bar.ev);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `800 19px ${FONT}`;
      g.fillText(clip(g, bar.ev.title, w - 16), x + 8, y + rowH - 14);
    }
    const hidden = week.allDay.filter((b) => b.row >= shownRows).length;
    if (hidden) {
      g.fillStyle = MUTED;
      g.font = `800 16px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(`+${hidden}`, gutter / 2, headH + stripH - 14);
      g.textAlign = 'left';
    }

    // Timed events, as blocks down their day; the past ones faded.
    const next = upNext(state.events, now);
    for (const b of week.timed) {
      const top = Math.max(gridTop, yOf(b.top));
      const bottom = Math.min(H - 4, yOf(b.bottom));
      if (bottom <= gridTop || top >= H - 4) continue;
      const laneW = (colW - 8) / b.lanes;
      const x = gutter + b.day * colW + 4 + b.lane * laneW;
      const w = laneW - 3;
      const h = Math.max(14, bottom - top - 3);
      g.globalAlpha = b.ev.end <= now ? 0.45 : 1;
      roundRect(g, x, top + 1, w, h, 7);
      g.fillStyle = eventColor(b.ev);
      g.fill();
      if (b.ev === next && b.ev.start <= now) {
        g.lineWidth = 4;
        g.strokeStyle = INK;
        g.stroke();
      }
      g.save();
      g.beginPath();
      g.rect(x, top + 1, w, h);
      g.clip();
      g.fillStyle = '#fff';
      if (h < 34) {
        // A short one: one line, as big as fits, across the middle.
        const fs = Math.min(16, h - 2);
        g.font = `900 ${fs}px ${FONT}`;
        if (fs >= 9) g.fillText(clip(g, `${b.ev.title}, ${clock(b.ev.start)}`, w - 10), x + 5, top + 1 + h / 2 + fs * 0.36);
        g.restore();
        g.globalAlpha = 1;
        continue;
      }
      const fs = 20;
      g.font = `900 ${fs}px ${FONT}`;
      const lines = wrap(g, b.ev.title, w - 12, Math.max(1, Math.floor((h - 30) / (fs + 2))));
      lines.forEach((line, i) => g.fillText(line, x + 6, top + fs + 4 + i * (fs + 2)));
      if (h >= 34 + lines.length * (fs + 2) - fs) {
        g.font = `700 16px ${FONT}`;
        g.fillText(clip(g, `${clock(b.ev.start)} – ${clock(b.ev.end)}`, w - 12), x + 6, top + fs + 4 + lines.length * (fs + 2) + 2);
      }
      g.restore();
      g.globalAlpha = 1;
    }

    // Now.
    if (today >= 0) {
      const y = yOf((now - week.days[today]) / 60_000);
      if (y >= gridTop && y <= H) {
        g.fillStyle = NOW;
        g.fillRect(gutter + today * colW, y - 2, colW, 4);
        g.beginPath();
        g.arc(gutter + today * colW, y, 9, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (state.error) {
      g.fillStyle = NOW;
      g.font = `800 18px ${FONT}`;
      g.textAlign = 'right';
      g.fillText(clip(g, `⚠️ ${state.error}`, W - 40), W - 12, H - 12);
      g.textAlign = 'left';
    }
    this.texture.needsUpdate = true;
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.roundRect(x, y, Math.max(0, w), Math.max(0, h), rr);
}
