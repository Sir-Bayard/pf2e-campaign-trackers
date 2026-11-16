/** Dates on the world's calendar: reading and writing them, and the GM's reminders when a date comes. */

import { esc } from "./kit/safe-text.mjs";
import { whisperGM } from "./chat.mjs";
import { MOD, clone, lz, num, tabs } from "./core.mjs";
import { storeReady } from "./presets.mjs";
import { Store, mutate } from "./store.mjs";

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

function months() {
  const vals = game.time?.calendar?.months?.values ?? [];
  return vals.map((m) => ({ name: m.name, short: String(m.abbreviation || m.name).split(",")[0].trim(), days: m.days }));
}

/** Today's date as { y, m, d }, with the year as the calendar shows it and months and days from 1. */
function today() {
  const c = game.time.components ?? {};
  const y0 = num(game.time.calendar?.years?.yearZero, 0);
  return { y: num(c.year) + y0, m: num(c.month) + 1, d: num(c.dayOfMonth) + 1 };
}

/** What the world's calendar is, as dates depend on it: its months, their lengths, and the year it counts from. */
function calendarSig() {
  const c = game.time?.calendar;
  return JSON.stringify([num(c?.years?.yearZero, 0), months().map((m) => [m.name, m.days])]);
}
/** Foundry's own calendar, in place until a calendar module sets its own (which may be after ready). */
const defaultCalendar = () => months().some((m) => String(m.name).startsWith("CALENDAR.GREGORIAN."));
/** When this client started, for the calendar a module may still be putting in place. */
const startedAt = Date.now();

/** Is the world's calendar the one the stored dates were set on? (True before the first is noted.) */
const sameCalendar = () => !Store.data.calendar || Store.data.calendar === calendarSig();

const dkey = (x) => (x && Number.isFinite(x.y) ? x.y * 100000 + x.m * 100 + x.d : null);

function fmtDate(x, { year = false } = {}) {
  if (!x) return "";
  const mo = months()[x.m - 1];
  const showYear = year || x.y !== today().y;
  return `${x.d} ${mo?.short ?? `${lz("Month", { m: x.m })}`}${showYear ? ` ${x.y}` : ""}`;
}

function monthIndex(name) {
  const n = String(name).trim().toLowerCase();
  if (!n) return -1;
  const list = months();
  let i = list.findIndex((m) => m.short.toLowerCase() === n || m.name.toLowerCase() === n);
  if (i < 0 && n.length >= 3) i = list.findIndex((m) => m.short.toLowerCase().startsWith(n) || m.name.toLowerCase().startsWith(n));
  if (i < 0 && /^\d+$/.test(n)) i = Number(n) - 1;
  return i;
}

/**
 * A date typed against the world calendar: "15 <month>", "15 <month> 1534", "<month> 15" or "1534-12-15". Returns null for
 * blank and undefined if unreadable.
 */
function parseDate(str, defYear = today().y) {
  const s = String(str ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  let y, mi, d;
  let m = s.match(/^(-?\d{1,5})-(\d{1,2})-(\d{1,2})$/);
  if (m) [y, mi, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  else if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([^\d,]+?)(?:,?\s+(-?\d{1,5}))?(?:\s+[a-z.]+)?$/i))) [d, mi, y] = [Number(m[1]), monthIndex(m[2]), m[3] ? Number(m[3]) : defYear];
  else if ((m = s.match(/^([^\d,]+?)\s+(\d{1,2})(?:,?\s+(-?\d{1,5}))?$/i))) [mi, d, y] = [monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : defYear];
  else return undefined;
  const list = months();
  if (mi < 0 || (list.length && mi >= list.length)) return undefined;
  const days = list[mi]?.days;
  if (d < 1 || (days && d > days)) return undefined;
  return { y, m: mi + 1, d };
}

/** Whether { y, m, d } (months and days from 1) is a day on the world's calendar, as a typed date must be. */
function onCalendar({ y, m, d }) {
  if (![y, m, d].every(Number.isInteger) || Math.abs(y) > 99999) return false;
  const list = months();
  if (m < 1 || m > (list.length || 12)) return false;
  return d >= 1 && d <= (list[m - 1]?.days || 31);
}

/** An example date on the world's calendar, for a date box's placeholder and hints. */
const exampleDate = (withYear = false) => `15 ${months()[0]?.short ?? lz("Month2")}${withYear ? ` ${today().y}` : ""}`;

/** Find reminders due by `now` and mark them, in place. Returns the lines to whisper. */
function collectReminders(d, now) {
  const lines = [];
  const when = (k, date) => (k === now ? lz("TodayLower") : lz("OnDate", { date: fmtDate(date) }));
  for (const t of d.trackers) {
    const name = `<strong>${esc(t.name)}</strong>`;
    if (t.kind === "clock") {
      const segs = t.segments ?? [];
      let ticks = 0;
      const firstEmpty = segs.findIndex((s) => s.state === "empty");
      segs.forEach((s, i) => {
        const k = dkey(s.date);
        if (k === null) return;
        if (k > now) {
          s.reminded = null;
          return;
        }
        if (s.reminded === k) return;
        s.reminded = k;
        if (t.ordered) {
          const idx = firstEmpty < 0 ? -1 : firstEmpty + ticks;
          ticks++;
          if (idx < 0 || idx >= segs.length) lines.push(`${lz("WouldFillASegment", { name: name })} ${when(k, s.date)}${lz("ButItSAlreadyFull")}`);
          else lines.push(`${lz("FillsASegment", { name: name })} ${when(k, s.date)}${lz("SegmentOf", { x: idx + 1, length: segs.length })}${segs[idx].label ? `, ${esc(segs[idx].label.replace(/[.!?]+$/, ""))}` : ""}.`);
        } else if (s.state === "empty") {
          lines.push(`${lz("NameSegment", { name, n: i + 1 })}${s.label ? `, ${esc(s.label.replace(/[.!?]+$/, ""))},` : ""} ${lz("IsDue")} ${when(k, s.date)}.`);
        }
      });
    }
    if (t.kind === "quest") {
      const k = dkey(t.deadline);
      if (k !== null) {
        if (k > now) t.reminded = null;
        else if (t.reminded !== k) {
          t.reminded = k;
          if (t.status === "active" || t.status === "lead") lines.push(`${name} ${k === now ? lz("IsDueToday") : `${lz("WasDueOn", { deadline: fmtDate(t.deadline) })}`}.`);
        }
      }
    }
    if (t.kind === "checklist") {
      for (const e of t.entries ?? []) {
        const k = dkey(e.closes);
        if (k === null) continue;
        if (k > now) {
          e.reminded = null;
          continue;
        }
        if (e.reminded === k) continue;
        e.reminded = k;
        if (e.done) continue;
        lines.push(`${name}: ${esc(e.label)} ${k === now ? lz("ClosesToday") : `${lz("ClosedOn", { closes: fmtDate(e.closes) })}`}.`);
      }
    }
  }
  return lines;
}

let reminderTimer = null;
function scheduleReminders() {
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(checkReminders, 1000);
}

let toldCalendar = false;
async function checkReminders() {
  if (!storeReady || Store.broken || !game.settings.get(MOD, "reminders") || !(await tabs.leadNow())) return;
  // The first time, note the calendar the dates are set on (not Foundry's own default, which a calendar module may
  // not have replaced yet). Another calendar (a calendar module turned off, say) would read every date as some other
  // day, so reminders wait until the GM says to use this one. In the first minute, look again first.
  if (!Store.data.calendar) {
    // Foundry's own calendar in the first minute may only be waiting for a calendar module: look again first.
    if (defaultCalendar() && Date.now() - startedAt < 60000) {
      clearTimeout(reminderTimer);
      reminderTimer = setTimeout(checkReminders, 15000);
      return;
    }
    await mutate((d) => void (d.calendar = calendarSig()), { notify: false });
  }
  if (!sameCalendar()) {
    if (Date.now() - startedAt < 60000) {
      clearTimeout(reminderTimer);
      reminderTimer = setTimeout(checkReminders, 15000);
      return;
    }
    if (!toldCalendar) whisperGM([lz("RemindersArePausedTheWorldS")], "fa-solid fa-calendar-xmark");
    toldCalendar = true;
    return;
  }
  const now = dkey(today());
  const draft = clone(Store.data);
  const lines = collectReminders(draft, now);
  if (JSON.stringify(draft) === JSON.stringify(Store.data)) return;
  await mutate((d) => collectReminders(d, now), { notify: false });
  if (lines.length) whisperGM(lines, "fa-solid fa-bell", `${lz("CampaignTrackers")} ${fmtDate(today(), { year: true })}`);
}


export { months, today, calendarSig, defaultCalendar, startedAt, sameCalendar, dkey, fmtDate, monthIndex, parseDate, onCalendar, exampleDate, collectReminders, reminderTimer, scheduleReminders, toldCalendar, checkReminders };
