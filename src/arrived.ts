// When something in stock came in, for an opened card and a scanned label.
//
// The stock watch (src/tracker.ts) keeps, for every product in stock, when it came in, for as
// long as it stays, and writes it to `since.json` on the `stock-data` branch beside the activity
// record. Read from there:
//   - a time: CeX's own, from its 10-minute updates, so "about" that time;
//   - a gap between two looks, where CeX's time could not be used;
//   - "before" the record began, for what was already on the shelf at its first look;
//   - not listed: it came in after the latest look. CeX's own update time says when, by the same
//     rule as Just in, or failing that, "after" the latest look.
// With more than one copy, it is when the product came into stock and has stayed in stock: a
// second copy arriving while the first is on the shelf changes nothing CeX shows.

import { LAG, type SinceFile } from './tracker.ts';

const SINCE_URL = 'https://raw.githubusercontent.com/NotChris144/shelf-stock-finder/stock-data/since.json';
const MIN = 60_000;
const DAY = 864e5;

let cached: { got: number; file: SinceFile | null } | null = null;
let pending: Promise<SinceFile | null> | null = null;

/** The record in hand if it is fresh; `undefined` when it needs asking for. */
export function sinceInHand(): SinceFile | null | undefined {
  return cached && Date.now() - cached.got < 2 * MIN ? cached.file : undefined;
}

/** The record, or null when there is none yet or it could not be reached. */
export function loadSince(): Promise<SinceFile | null> {
  const have = sinceInHand();
  if (have !== undefined) return Promise.resolve(have);
  pending ??= fetch(`${SINCE_URL}?v=${Date.now()}`, { cache: 'no-store' })
    .then(async (res) => (res.ok ? ((await res.json()) as SinceFile) : null))
    .catch(() => null)
    .then((file) => {
      // A failure is kept briefly too, so a run of cards opening does not ask again each time.
      cached = { got: Date.now(), file };
      return file;
    })
    .finally(() => (pending = null));
  return pending;
}

export type Came = { k: 'at'; t: number } | { k: 'between'; a: number; t: number } | { k: 'before'; t: number } | { k: 'after'; t: number };

/** When the product came in, by the record; null when the record is for another branch. */
export function cameIn(file: SinceFile, store: string, id: string, stamp: number, now = Date.now()): Came | null {
  if (file.store !== store) return null;
  const v = file.in[id];
  if (v === undefined) return stamp > file.at - LAG && stamp <= now ? { k: 'at', t: stamp } : { k: 'after', t: file.at };
  if (v === 0) return { k: 'before', t: file.from };
  if (Array.isArray(v)) return { k: 'between', a: v[0] * MIN, t: v[1] * MIN };
  return { k: 'at', t: v * MIN };
}

// ------------------------------------------------------------------ in words

const midnight = (t: number): number => new Date(t).setHours(0, 0, 0, 0);
/** Calendar days from `t` to `now`: 0 today, 1 yesterday. */
const daysBack = (t: number, now: number): number => Math.round((midnight(now) - midnight(t)) / DAY);

/** "2:40pm", "9pm". */
function clock(t: number): string {
  return new Date(t).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, '').replace(':00', '').toLowerCase();
}

/** "today", "yesterday", "Wed 11 Nov" (with the year when it is not this one). */
function day(t: number, now: number): string {
  const d = daysBack(t, now);
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${new Date(t).toLocaleDateString('en-GB', { weekday: 'short' })} ${date(t, now)}`;
}

/** "11 Nov", or "11 Nov 2025" when it is not this year. */
function date(t: number, now: number): string {
  const year = new Date(t).getFullYear() !== new Date(now).getFullYear();
  return `${new Date(t).getDate()} ${new Date(t).toLocaleDateString('en-GB', { month: 'short' })}${year ? ` ${new Date(t).getFullYear()}` : ''}`;
}

/** "6 days ago", "3 weeks ago", "2 months ago"; nothing for today or yesterday, which say it already. */
function age(t: number, now: number): string {
  const d = daysBack(t, now);
  if (d < 2) return '';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 365) return `${Math.floor(d / 30.4)} months ago`;
  return d < 730 ? 'over a year ago' : `${Math.floor(d / 365)} years ago`;
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** In full, for an opened card: "Wed 11 Nov, about 2:40pm · 6 days ago". */
export function cameText(c: Came, now = Date.now()): string {
  switch (c.k) {
    case 'at': {
      const ago = age(c.t, now);
      return `${cap(day(c.t, now))}, about ${clock(c.t)}${ago ? ` · ${ago}` : ''}`;
    }
    case 'between': {
      const ago = age(c.t, now);
      const span = day(c.a, now) === day(c.t, now) ? `${cap(day(c.t, now))}, between ${clock(c.a)} and ${clock(c.t)}` : `Between ${clock(c.a)} ${day(c.a, now)} and ${clock(c.t)} ${day(c.t, now)}`;
      return `${span}${ago ? ` · ${ago}` : ''}`;
    }
    case 'before': {
      // Already on the shelf when the watch began, so all that is known is that it is older.
      const ago = age(c.t, now);
      return ago ? `Over ${ago} (records begin ${day(c.t, now)})` : `Before ${clock(c.t)} ${day(c.t, now)}, when records begin`;
    }
    case 'after':
      return `After ${clock(c.t)} ${day(c.t, now)}, when stock was last checked`;
  }
}

/** In a few words, for a scanned label or one copy of several: "came in 6 days ago". */
export function cameShort(c: Came, now = Date.now()): string {
  const d = daysBack(c.t, now);
  const when = d === 0 ? 'today' : d === 1 ? 'yesterday' : age(c.t, now);
  switch (c.k) {
    case 'at':
      return `came in ${when}${d === 0 ? `, ${clock(c.t)}` : ''}`;
    case 'between':
      return day(c.a, now) === day(c.t, now) ? `came in ${when}` : `came in between ${day(c.a, now)} and ${day(c.t, now)}`;
    case 'before':
      return `came in before ${date(c.t, now)}`;
    case 'after':
      return `came in since ${clock(c.t)} ${day(c.t, now)}`;
  }
}

export { cap as capitalise };
