// The two stock-activity screens: what has just come in, and what tech has recently sold.
//
// The record is kept by a scheduled job (src/tracker.ts) on the repository's `stock-data` branch
// and read from there. Until it holds its first change, the screens show sample data: real
// products from the shelf with made-up times, clearly marked, so the layout can be seen and
// used. The first real change replaces it, with nothing to switch.
//
// Just in does not wait for the job for tech. While it is open it asks CeX itself which tech the
// branch has, every couple of minutes, and anything the job's last look had not seen is shown
// straight away, timed by CeX's own update time. So a phone shows within CeX's 10-minute update
// cycle of being taken into stock; the job then records it for good.

import type { FlowHost } from './flows.ts';
import { recsOf, techNow, toHit, type Log } from './tracker.ts';
import type { Group, Item } from './types.ts';

const LOG_URL = 'https://raw.githubusercontent.com/NotChris144/shelf-stock-finder/stock-data/log.json';
const MIN = 60_000;
const DAY = 864e5;

export type ActivityKind = 'in' | 'sold';

interface Entry {
  /** By when it happened, and the look before (it happened in between). */
  t: number;
  a: number;
  /** `t` is CeX's own time for the change, so it stands without the gap before it. */
  e?: boolean;
  it: Item;
}

// ------------------------------------------------------------------ reading the record

let cached: { at: number; log: Log | null } | null = null;
let pending: Promise<Log | null> | null = null;

/** The record, or null when there is none yet. Rejects when it could not be reached. */
export function loadLog(fresh = false): Promise<Log | null> {
  if (cached && !fresh && Date.now() - cached.at < MIN) return Promise.resolve(cached.log);
  // A new address each minute, so a cached copy along the way is never more than a minute old.
  pending ??= fetch(`${LOG_URL}?v=${Math.floor(Date.now() / MIN)}`, { cache: 'no-store' })
    .then(async (res) => (res.ok ? ((await res.json()) as Log) : res.status === 404 ? null : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((log) => {
      cached = { at: Date.now(), log };
      return log;
    })
    .finally(() => (pending = null));
  return pending;
}

/** Forget the copy in hand, so the next look asks again (the phone has been in a pocket). */
export function forgetLog(): void {
  cached = null;
}

/** The record counts from its first change: before that there is nothing real to show. */
const isLive = (log: Log | null): log is Log => Boolean(log && log.arrivals.length + log.sold.length > 0);

// ------------------------------------------------------------------ asking CeX directly

let fresh_: { at: number; key: number; entries: Entry[]; ok: boolean } | null = null;

/**
 * Tech CeX lists at the branch now that the job's last look had not seen: come in, not yet
 * recorded. `ok` is false when CeX could not be asked, and then nothing is added.
 */
async function arrivingNow(host: FlowHost, log: Log | null, again = false): Promise<{ at: number; entries: Entry[]; ok: boolean }> {
  if (!log?.seen) return { at: 0, entries: [], ok: false };
  if (fresh_ && !again && fresh_.key === log.at && Date.now() - fresh_.at < MIN) return fresh_;
  const now = Date.now();
  try {
    const seen = new Set(log.seen);
    const ids = (await techNow(log.store)).filter((id) => !seen.has(id));
    const recs = (await recsOf(ids.slice(0, 60))).filter((r) => r.t);
    const entries = recs.map((r): Entry => {
      const exact = r.u !== undefined && r.u > log.at && r.u <= now;
      return { t: exact ? r.u! : now, a: log.at, e: exact, it: host.toItem(toHit(r)) };
    });
    fresh_ = { at: now, key: log.at, entries, ok: true };
  } catch {
    // CeX busy or no signal: keep what was found last time against the same look, if anything.
    fresh_ = { at: fresh_?.at ?? 0, key: log.at, entries: fresh_?.key === log.at ? fresh_.entries : [], ok: false };
  }
  return fresh_;
}

// ------------------------------------------------------------------ sample data

let sample: { in: Entry[]; sold: Entry[] } | null = null;

/** A fixed shuffle, so the sample reads the same each time it is opened today. */
function shuffle<T>(list: T[], seed: number): T[] {
  let s = seed;
  const rnd = (): number => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return list
    .map((x) => [rnd(), x] as const)
    .sort((x, y) => x[0] - y[0])
    .map(([, x]) => x);
}

async function sampleData(host: FlowHost): Promise<{ in: Entry[]; sold: Entry[] }> {
  if (sample) return sample;
  const items = (await host.sampleHits()).map((h) => host.toItem(h));
  const day = new Date();
  const seed = day.getFullYear() * 400 + day.getMonth() * 32 + day.getDate();
  const now = Date.now();
  // Arrivals a few minutes to seven hours ago; sales across the last two days.
  const stamp = (list: Item[], spread: number): Entry[] =>
    list.map((it, i) => {
      const t = now - Math.round(((i + 1) / list.length) * spread * (0.6 + ((seed + i * 7) % 10) / 25));
      return { t, a: t - 15 * MIN, it };
    });
  const tech = items.filter((it) => /^(Phones|Computing|Electronics)$/.test(it.superCat));
  sample = {
    in: stamp(shuffle(items, seed).slice(0, 26), 7 * 60 * MIN).sort((x, y) => y.t - x.t),
    sold: stamp(shuffle(tech, seed + 1).slice(0, 12), 2 * DAY).sort((x, y) => y.t - x.t),
  };
  return sample;
}

// ------------------------------------------------------------------ how it reads

const clock = (t: number): string => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayOf = (t: number): string => new Date(t).toDateString();

function dayName(t: number, now: number): string {
  if (dayOf(t) === dayOf(now)) return 'Today';
  if (dayOf(t) === dayOf(now - DAY)) return 'Yesterday';
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** How long ago, as a phone puts it: "12 min ago" today, the time of day further back. */
export function ago(t: number, a: number, now: number, exact = false): string {
  // After a long gap between looks (overnight), all that is known is that it happened before this
  // look, unless CeX's own time says exactly when.
  if (!exact && t - a > 45 * MIN) return `before ${clock(t)}`;
  if (dayOf(t) !== dayOf(now)) return clock(t);
  const min = Math.round((now - t) / MIN);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ago`;
}

const sinceText = (t: number, now: number): string => (dayOf(t) === dayOf(now) ? clock(t) : `${clock(t)} ${dayName(t, now).toLowerCase()}`);

/** Which chip an item falls under. */
function sectionOf(it: Item): string {
  if (it.kind === 'phone') return 'phones';
  if (it.kind === 'tablet') return 'tablets';
  if (it.kind === 'laptop' || it.kind === 'desktop' || it.superCat === 'Computing') return 'computers';
  if (it.superCat === 'Gaming') return 'gaming';
  if (it.superCat === 'Film & TV') return 'film';
  return 'other';
}

const SECTIONS: Record<ActivityKind, [string, string][]> = {
  in: [
    ['phones', 'Phones'],
    ['tablets', 'Tablets'],
    ['computers', 'Computers'],
    ['gaming', 'Gaming'],
    ['film', 'Film & TV'],
    ['other', 'Other'],
  ],
  sold: [
    ['phones', 'Phones'],
    ['tablets', 'Tablets'],
    ['computers', 'Computers'],
    ['gaming', 'Consoles'],
    ['other', 'Electronics'],
  ],
};

export const TITLES: Record<ActivityKind, string> = { in: 'Just in', sold: 'Recently sold' };

// ------------------------------------------------------------------ the screens

let drawn = '';
let refresh = 0;
/** The record behind the last draw, so a refresh only redraws when something has changed. */
let shownAt = '';

export async function drawActivity(host: FlowHost, kind: ActivityKind, filter: string, body: HTMLElement, fresh = false): Promise<void> {
  const token = (drawn = `${kind}|${filter}`);
  window.clearTimeout(refresh);
  if (!body.childElementCount) body.innerHTML = '<ul class="list"><li class="card skeleton"></li><li class="card skeleton"></li><li class="card skeleton"></li></ul>';
  let log: Log | null = null;
  let offline = false;
  try {
    log = await loadLog(fresh);
  } catch {
    offline = true;
  }
  let entries: Entry[];
  const now0 = Date.now();
  const direct = await arrivingNow(host, log, fresh);
  // Real from the first change, whether the job recorded it or CeX was asked directly.
  const live = isLive(log) || direct.entries.length > 0;
  if (live) {
    const recorded = (kind === 'in' ? log!.arrivals : log!.sold).map((e): Entry => ({ t: e.t, a: e.a, e: Boolean(e.e), it: host.toItem(toHit(e.r)) }));
    entries = kind === 'in' ? [...direct.entries, ...recorded].sort((x, y) => y.t - x.t) : recorded;
  } else {
    try {
      entries = (await sampleData(host))[kind];
    } catch {
      if (token !== drawn) return;
      body.innerHTML = `<div class="empty"><p>Couldn’t load stock activity. Check your connection.</p><button type="button" class="chip" data-act="retry-activity" aria-pressed="true">Try again</button></div>`;
      return;
    }
  }
  if (token !== drawn || !body.isConnected) return;
  const now = Math.max(now0, Date.now());
  const asked = kind === 'in' && direct.ok ? direct.at : 0;
  const stamp = `${live}|${log?.at ?? 0}|${entries.map((e) => e.it.id).join(',')}`;
  // Only the "checked" line changes when nothing new has come through: open cards stay open.
  if (fresh && stamp === shownAt) {
    const sub = body.querySelector('.act-sub');
    if (sub && log) sub.textContent = checkedText(log, now, host.branch(), asked);
    schedule(host, kind, filter, body);
    return;
  }
  shownAt = stamp;

  const counts = new Map<string, number>();
  for (const e of entries) counts.set(sectionOf(e.it), (counts.get(sectionOf(e.it)) ?? 0) + 1);
  const chips = SECTIONS[kind].filter(([id]) => counts.has(id) || filter === id);
  const shown = filter ? entries.filter((e) => sectionOf(e.it) === filter) : entries;

  let html = '';
  if (live) html += `<p class="act-sub">${host.esc(checkedText(log!, now, host.branch(), asked))}</p>`;
  else
    html += `<p class="note sample"><b>Sample data.</b> Real items from the shelf with made-up times, to show how this will look. ${
      offline ? 'The record could not be reached just now.' : 'The real record replaces it as soon as the first stock changes come through.'
    }</p>`;
  if (chips.length > 1 || filter) {
    html += `<div class="frow act-filter">${host.chip('ac', '', `All <em>${entries.length}</em>`, !filter)}${chips
      .map(([id, label]) => host.chip('ac', id, `${label} <em>${counts.get(id) ?? 0}</em>`, filter === id))
      .join('')}</div>`;
  }
  if (!shown.length) {
    const what = filter ? SECTIONS[kind].find(([id]) => id === filter)?.[1].toLowerCase() : '';
    html += `<div class="empty"><p>${
      kind === 'in'
        ? `No ${what ? `${what} ` : ''}stock has come in since ${log ? sinceText(log.started, now) : 'the record began'}.`
        : `No ${what || 'tech'} has sold since ${log ? sinceText(log.started, now) : 'the record began'}.`
    }</p></div>`;
  }
  let day = '';
  for (const e of shown) {
    const name = dayName(e.t, now);
    if (name !== day) {
      html += `${day ? '</ul>' : ''}<h3 class="day">${name}</h3><ul class="list">`;
      day = name;
    }
    const g: Group = { key: `act:${kind}:${e.it.id}:${e.t}`, items: [e.it], head: e.it, min: e.it.price, max: e.it.price };
    host.register(g);
    html += host.cardHtml(g, '', { cls: ' feed', when: ago(e.t, e.a, now, e.e), plain: true });
  }
  if (day) html += '</ul>';
  html += `<p class="fine">${
    kind === 'in'
      ? `Tech is checked with CeX every two minutes while this screen is open, and shows within CeX’s own 10-minute update of being taken into stock. Everything else is checked every 15 minutes while the shop is open. An item shows the first time it appears in ${host.esc(log?.store ?? 'the branch')}’s stock online; another copy of something already on the shelf doesn’t show, because CeX lists one entry per product.`
      : `Phones, tablets, computers, consoles and electronics. An item shows here when the last one leaves ${host.esc(log?.store ?? 'the branch')}’s stock online, which is nearly always a sale and now and then a move to another store.`
  }</p>`;
  body.innerHTML = html;
  schedule(host, kind, filter, body);
}

/** "Eastbourne · Checked 4 min ago", or with tech asked directly: "Eastbourne · Tech checked just now, the rest 4 min ago". */
function checkedText(log: Log, now: number, branch: string, asked = 0): string {
  const since = (t: number): string => {
    const min = Math.round((now - t) / MIN);
    return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : dayOf(t) === dayOf(now) ? `at ${clock(t)}` : `${dayName(t, now).toLowerCase()} at ${clock(t)}`;
  };
  const where = log.store === branch ? log.store : `${log.store} only`;
  return asked ? `${where} · Tech checked ${since(asked)}, the rest ${since(log.at)}` : `${where} · Checked ${since(log.at)}`;
}

/** While a screen is open, look again every two minutes. */
function schedule(host: FlowHost, kind: ActivityKind, filter: string, body: HTMLElement): void {
  window.clearTimeout(refresh);
  refresh = window.setTimeout(() => {
    if (body.isConnected && drawn === `${kind}|${filter}` && document.visibilityState === 'visible') void drawActivity(host, kind, filter, body, true);
  }, 2 * MIN);
}

// ------------------------------------------------------------------ on the start screen

const ICON_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10M8 10.5l4 4 4-4"/><path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14"/></svg>';
const ICON_SOLD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12.6V5a1.5 1.5 0 0 1 1.5-1.5h7.6l8.4 8.4a1.5 1.5 0 0 1 0 2.1l-6.5 6.5a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8.2" cy="8.2" r="1.6"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

/** Two rows on the start screen. Their counts fill in once the record has been read (see `fillActivity`). */
export function activityRows(): string {
  const row = (kind: ActivityKind, icon: string, sub: string): string =>
    `<button type="button" class="row" data-act="activity" data-v="${kind}"><span class="row-icon ${kind}">${icon}</span><span class="row-text"><b>${TITLES[kind]}</b><small>${sub}</small></span><span class="row-n" data-count="${kind}"></span>${ICON_NEXT}</button>`;
  return `<h3>Activity</h3><div class="group">${row('in', ICON_IN, 'Bought in, newest first')}${row('sold', ICON_SOLD, 'Tech that has left the shelf')}</div>`;
}

export async function fillActivity(host: FlowHost, root: HTMLElement): Promise<void> {
  let log: Log | null = null;
  try {
    log = await loadLog();
  } catch {
    /* the rows still work; they just show no count */
  }
  const direct = await arrivingNow(host, log);
  const now = Date.now();
  const today = (list: { t: number }[]): number => list.filter((e) => dayOf(e.t) === dayOf(now)).length;
  const live = isLive(log) || direct.entries.length > 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-count]')) {
    if (!live || !log) {
      el.textContent = 'Sample';
      el.classList.add('is-sample');
      continue;
    }
    const n = el.dataset.count === 'in' ? today(log.arrivals) + today(direct.entries) : today(log.sold);
    el.textContent = n ? `${n} today` : 'None today';
    el.classList.remove('is-sample');
  }
}
