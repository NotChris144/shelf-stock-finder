// Stock moves at one branch: what has come in and what has gone.
//
// CeX's search says what a branch has in stock now, but not when anything arrived or left, and
// not how many of a product there are. So the whole branch is listed every 15 minutes by a
// scheduled job (scripts/track-stock.ts) and each list is compared with the one before:
//   - a product that was not there before has come in (bought in, or another copy of something
//     that had sold out);
//   - a product that has gone, and is still gone at the next look, has left: the last one sold,
//     or now and then moved to another store.
// Waiting for a second look before calling something gone keeps a hiccup in the search from
// showing as a sale. The job keeps the record on the repository's `stock-data` branch, and the
// app reads `log.json` from there.

import { CONFIG } from './api.ts';
import type { Hit } from './types.ts';

/** A product as recorded: just enough to show it again. */
export interface Rec {
  id: string;
  /** CeX's name, price, category and department. */
  n: string;
  p: number;
  c: string;
  s: string;
  /** Picture. */
  i?: string;
  g?: string;
  /** Phones, computers, electronics and gaming hardware: the things whose sales are kept. */
  t?: 1;
  /** Maker and model, for the app to recognise a phone or tablet. */
  m?: string;
  pm?: string;
  mn?: string;
  cpu?: string;
  gen?: string;
}

/** Something that happened between two looks: after `a` (the look before) and by `t`. */
export interface Ev {
  t: number;
  a: number;
  r: Rec;
}

export interface Log {
  store: string;
  /** When the record began, and the latest look. */
  started: number;
  at: number;
  /** Newest first. */
  arrivals: Ev[];
  /** Tech only, newest first. */
  sold: Ev[];
}

/** What the job carries from one look to the next. */
export interface State {
  store: string;
  at: number;
  count: number;
  ids: string[];
  /** Full records of tech in stock, so a sale can still be described after it has gone. */
  tech: Record<string, Rec>;
  /** Gone at the last look but not yet confirmed: when that was noticed (`s`) and last seen (`l`). */
  missing: Record<string, { s: number; l: number; r?: Rec }>;
}

const FILTER = 'boxVisibilityOnWeb=1 AND boxSaleAllowed=1 AND sellPrice > 0';
const FIELDS = ['boxId', 'boxName', 'sellPrice', 'categoryFriendlyName', 'superCatFriendlyName', 'productLineName', 'imageUrls', 'Grade', 'Manufacturer', 'Phone Model', 'Model Name', 'CPU Model', 'Generation'];
/** The most one request returns. */
const PAGE = 1000;

const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v)).trim();
const all = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

const TECH = new Set(['Phones', 'Computing', 'Electronics']);
/** Devices, not discs: games, board games and figures are not tech. */
function isTech(h: Hit): boolean {
  const s = first(h.superCatFriendlyName);
  if (TECH.has(s)) return true;
  return s === 'Gaming' && !all(h.productLineName).some((l) => /gaming software|board games|wargaming/i.test(l));
}

function toRec(h: Hit): Rec {
  const r: Rec = { id: String(h.boxId), n: String(h.boxName ?? ''), p: Number(h.sellPrice) || 0, c: first(h.categoryFriendlyName), s: first(h.superCatFriendlyName) };
  const img = h.imageUrls?.medium ?? h.imageUrls?.small ?? '';
  if (img) r.i = img;
  const g = first(h.Grade);
  if (g) r.g = g;
  if (isTech(h)) {
    r.t = 1;
    const put = (k: 'm' | 'pm' | 'mn' | 'cpu' | 'gen', v: unknown): void => {
      const x = first(v);
      if (x) r[k] = x;
    };
    put('m', h.Manufacturer);
    put('pm', h['Phone Model']);
    put('mn', h['Model Name']);
    put('cpu', h['CPU Model']);
    put('gen', h.Generation);
  }
  return r;
}

/** Back into the shape the app reads search results in. */
export function toHit(r: Rec): Hit {
  return {
    boxId: r.id,
    boxName: r.n,
    sellPrice: r.p,
    categoryFriendlyName: r.c,
    superCatFriendlyName: r.s,
    imageUrls: r.i ? { medium: r.i } : null,
    Grade: r.g ? [r.g] : null,
    Manufacturer: r.m ? [r.m] : undefined,
    'Phone Model': r.pm ? [r.pm] : undefined,
    'Model Name': r.mn ? [r.mn] : undefined,
    'CPU Model': r.cpu ? [r.cpu] : undefined,
    Generation: r.gen ? [r.gen] : undefined,
  };
}

interface Result {
  nbHits?: number;
  hits?: Hit[];
  facets?: Record<string, Record<string, number>>;
}

/** CeX's search allows each address only so many queries an hour, and said so. */
export class Busy extends Error {}

/** Queries sent this run: each entry in a batch counts, not each request. */
export let queries = 0;

async function post(requests: unknown[]): Promise<Result[]> {
  queries += requests.length;
  const res = await fetch(`${CONFIG.endpoint}?x-algolia-application-id=${CONFIG.appId}&x-algolia-api-key=${CONFIG.apiKey}`, { method: 'POST', body: JSON.stringify({ requests }) });
  if (res.status === 429) throw new Busy('CeX search: too many requests from this address');
  if (!res.ok) throw new Error(`CeX search: HTTP ${res.status}`);
  return (await res.json()).results as Result[];
}

const ask = (facetFilters: string[][], extra: Record<string, unknown> = {}): unknown => ({
  indexName: CONFIG.index,
  query: '',
  hitsPerPage: PAGE,
  filters: FILTER,
  facetFilters,
  attributesToRetrieve: FIELDS,
  attributesToHighlight: [],
  analytics: false,
  clickAnalytics: false,
  ...extra,
});

/** Put counted things into as few groups of at most `PAGE` as their order allows. */
function bands<T>(list: [T, number][]): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let sum = 0;
  for (const [x, n] of list) {
    if (cur.length && sum + n > PAGE) {
      out.push(cur);
      cur = [];
      sum = 0;
    }
    cur.push(x);
    sum += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Everything the branch has in stock now. One request lists at most 1,000 products, and CeX
 * allows each address only so many queries an hour, so the branch is cut into as few pieces as
 * will each fit in one request: bands of price, and where a single price holds more than 1,000
 * products (£1.50 discs), groups of categories at that price. About a dozen queries in all.
 */
export async function fetchStock(store: string): Promise<{ total: number; recs: Rec[] }> {
  queries = 0;
  const here = [`stores:${store}`];
  const count = { hitsPerPage: 0, maxValuesPerFacet: 1000, attributesToRetrieve: [] };
  const [head] = await post([ask([here], { ...count, facets: ['sellPrice'] })]);
  const total = Number(head.nbHits) || 0;
  const prices = Object.entries(head.facets?.sellPrice ?? {})
    .map(([p, n]): [number, number] => [Number(p), n])
    .sort((x, y) => x[0] - y[0]);
  // Every product has a price, so the prices must account for all of them; if not, the list was cut short.
  if (prices.reduce((n, [, c]) => n + c, 0) !== total) throw new Error(`prices account for ${prices.reduce((n, [, c]) => n + c, 0)} of ${total} products`);
  const requests: unknown[] = [];
  const crowded = prices.filter(([, n]) => n > PAGE).map(([p]) => p);
  // Runs of prices between the crowded ones, each run in as few bands as fit.
  let run: [number, number][] = [];
  const flush = (): void => {
    for (const b of bands(run)) requests.push(ask([here], { numericFilters: [`sellPrice>=${b[0]}`, `sellPrice<=${b[b.length - 1]}`] }));
    run = [];
  };
  for (const [p, n] of prices) {
    if (n > PAGE) flush();
    else run.push([p, n]);
  }
  flush();
  if (crowded.length) {
    const split = await post(crowded.map((p) => ask([here], { ...count, facets: ['categoryFriendlyName'], numericFilters: [`sellPrice=${p}`] })));
    crowded.forEach((p, i) => {
      const cats = Object.entries(split[i].facets?.categoryFriendlyName ?? {});
      for (const b of bands(cats)) requests.push(ask([here, b.map((c) => `categoryFriendlyName:${c}`)], { numericFilters: [`sellPrice=${p}`] }));
    });
  }
  const recs = new Map<string, Rec>();
  for (let i = 0; i < requests.length; i += 20) {
    for (const r of await post(requests.slice(i, i + 20))) for (const h of r.hits ?? []) recs.set(String(h.boxId), toRec(h));
  }
  return { total, recs: [...recs.values()] };
}

export interface Outcome {
  state: State;
  arrivals: Ev[];
  sold: Ev[];
  /** Why nothing was recorded this time, when that is the case. */
  skipped?: string;
}

/** Compare what is in stock now with the last look. */
export function compare(prev: State | null, recs: Rec[], total: number, now: number, store: string): Outcome {
  const tech = Object.fromEntries(recs.filter((r) => r.t).map((r) => [r.id, r]));
  const fresh: State = { store, at: now, count: recs.length, ids: recs.map((r) => r.id), tech, missing: {} };
  // A list that came back short is the search having a moment, not half the shop selling out.
  if (recs.length < total * 0.98) return { state: prev ?? fresh, arrivals: [], sold: [], skipped: `listed ${recs.length} of ${total} products` };
  if (prev && prev.store === store && recs.length < prev.count * 0.85) return { state: prev, arrivals: [], sold: [], skipped: `${recs.length} products, down from ${prev.count}` };
  // The first look only sets the starting point: everything on the shelf is not "just in".
  if (!prev || prev.store !== store) return { state: fresh, arrivals: [], sold: [] };

  const now_ = new Set(fresh.ids);
  const before = new Set(prev.ids);
  const missing = { ...prev.missing };
  const arrivals: Ev[] = [];
  const sold: Ev[] = [];
  for (const r of recs) {
    if (before.has(r.id)) continue;
    // Gone at the last look and back now: a hiccup, not a sale and a purchase.
    if (missing[r.id]) delete missing[r.id];
    else arrivals.push({ t: now, a: prev.at, r });
  }
  for (const [id, m] of Object.entries(prev.missing)) {
    if (now_.has(id)) continue;
    delete missing[id];
    if (m.r) sold.push({ t: m.s, a: m.l, r: m.r });
  }
  for (const id of prev.ids) {
    if (!now_.has(id)) missing[id] = prev.tech[id] ? { s: now, l: prev.at, r: prev.tech[id] } : { s: now, l: prev.at };
  }
  fresh.missing = missing;
  return { state: fresh, arrivals, sold };
}

const DAY = 864e5;

/** Add what happened to the record, keeping a week of arrivals and a fortnight of sales. */
export function record(log: Log | null, out: Outcome, store: string, now: number): Log {
  const base: Log = log && log.store === store ? log : { store, started: now, at: now, arrivals: [], sold: [] };
  const keep = (list: Ev[], days: number, most: number): Ev[] => list.filter((e) => now - e.t <= days * DAY).sort((x, y) => y.t - x.t).slice(0, most);
  return {
    ...base,
    at: now,
    arrivals: keep([...out.arrivals, ...base.arrivals], 7, 800),
    sold: keep([...out.sold, ...base.sold], 14, 400),
  };
}
