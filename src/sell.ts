// Recommendation logic: which in-stock item is a worthwhile step up from another, and why.
//
// Every reason produced here is a fact that is true of both items. If nothing concrete is better,
// no step up is offered — the screen is shown to customers, so it has to hold up when read.

import { norm, stripNet } from './eol.ts';
import { cameraText } from './specs.ts';
import type { Item } from './types.ts';

const YEAR = 365.25 * 864e5;
const clamp = (v: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, v));

/** One sellable thing: a model at a storage size, across its colours and grades. */
export interface Product {
  key: string;
  items: Item[];
  /** Cheapest variant; its price is the product's price. */
  head: Item;
  price: number;
  score: number;
}

export interface Diff {
  /** What `to` does better than `from`, most persuasive first. */
  gains: string[];
  /** What it gives up. */
  losses: string[];
}

const GRADE: Record<string, number> = { A: 1, B: 0.65, C: 0.25 };

/** Is it receiving updates today? Amber counts only when the end is still ahead. */
export const getsUpdates = (s: Item['support']): boolean => s.status === 'ok' || (s.status === 'warn' && !s.stale);

function cameraScore(it: Item): number | null {
  const s = it.specs;
  if (!s) return null;
  // Lens count and megapixels say what a camera can do, not how good its pictures are, so the
  // phone's class (its chip) scales the result: a budget 50MP sensor is not a flagship camera.
  const lenses = 0.25 + (s.ultrawide ? 0.15 : 0) + (s.zoom ? 0.2 : 0) + (s.mp >= 48 ? 0.1 : 0);
  return clamp(lenses * (0.5 + (it.perf?.pct ?? 0.3)));
}

/**
 * Overall desirability, 0..1. Weighted towards what customers here ask about: lasting updates
 * and speed first, then camera, storage, battery and condition.
 */
export function quality(it: Item, now: number): number {
  const s = it.support;
  let updates: number;
  if (s.status === 'ended') updates = 0;
  else if (s.status === 'unknown' || s.status === 'na') updates = 0.25;
  else if (s.until !== undefined) updates = clamp((s.until - now) / (6 * YEAR)) * 0.85 + 0.15;
  else updates = s.status === 'ok' ? 0.6 : 0.35;
  const speed = it.perf?.pct ?? 0.3;
  const storage = it.storageGb ? clamp(Math.log2(it.storageGb / 16) / 6) : 0.4;
  const grade = GRADE[it.grade] ?? 0.5;
  const camera = cameraScore(it) ?? speed;
  // Battery is rated within its own platform: iPhones last as long on far fewer mAh.
  const mah = it.specs?.mah ?? 0;
  const battery = !mah ? 0.5 : it.os === 'iOS' ? clamp((mah - 1800) / 2900) : clamp((mah - 3000) / 2200);
  return updates * 0.3 + speed * 0.28 + camera * 0.1 + storage * 0.12 + battery * 0.1 + grade * 0.1;
}

export function products(items: Item[], now: number): Product[] {
  const map = new Map<string, Product>();
  for (const it of items) {
    if (it.kind !== 'phone' && it.kind !== 'tablet') continue;
    const p = map.get(it.gkey);
    if (!p) map.set(it.gkey, { key: it.gkey, items: [it], head: it, price: it.price, score: 0 });
    else {
      p.items.push(it);
      if (it.price < p.price) {
        p.price = it.price;
        p.head = it;
      }
    }
  }
  const out = [...map.values()];
  for (const p of out) {
    p.items.sort((a, b) => a.price - b.price || a.variant.localeCompare(b.variant));
    p.score = quality(p.head, now);
  }
  return out;
}

const gb = (n: number): string => (n >= 1024 ? `${n / 1024}TB` : `${n}GB`);
const num = (n: number): string => n.toLocaleString('en-GB');
const yearOf = (t: number): number => new Date(t).getUTCFullYear();
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Facts that separate two items, phrased from the point of view of moving from `from` to `to`. */
export function diff(from: Item, to: Item): Diff {
  const gains: string[] = [];
  const losses: string[] = [];
  const a = from.support;
  const b = to.support;
  const live = getsUpdates;

  if (live(b) && a.status === 'ended') {
    gains.push(`Still gets software updates${b.until ? ` until ${b.est ? 'about ' : ''}${yearOf(b.until)}` : ''}; the ${from.title} no longer does`);
  } else if (live(b) && (a.status === 'unknown' || a.stale)) {
    gains.push(`Software updates confirmed${b.until ? ` until ${b.est ? 'about ' : ''}${yearOf(b.until)}` : ''}; not confirmed for the ${from.title}`);
  } else if (live(a) && (b.status === 'ended' || b.stale)) {
    losses.push('No longer gets software updates');
  } else if (live(a) && live(b) && a.until && b.until) {
    // Counted from the two years printed beside it, so the reader's own subtraction agrees.
    const years = yearOf(b.until) - yearOf(a.until);
    const approx = a.est || b.est ? 'about ' : '';
    if (years >= 1) gains.push(`${approx.replace(/^a/, 'A')}${plural(years, 'more year')} of updates (to ${yearOf(b.until)} instead of ${yearOf(a.until)})`);
    else if (years <= -1) losses.push(`${approx.replace(/^a/, 'A')}${plural(-years, 'fewer year')} of updates (to ${yearOf(b.until)})`);
  }

  if (from.perf && to.perf) {
    const r = to.perf.score / from.perf.score;
    if (r >= 2.7) gains.push(`About ${Math.round(r)} times as fast`);
    else if (r >= 1.8) gains.push('About twice as fast');
    else if (r >= 1.15) gains.push(`About ${Math.round(((r - 1) * 100) / 5) * 5}% faster`);
    else if (r <= 0.87) losses.push(`Slower (about ${Math.round(((1 - r) * 100) / 5) * 5}% less speed)`);
  }

  if (from.storageGb && to.storageGb && from.storageGb !== to.storageGb) {
    const r = to.storageGb / from.storageGb;
    if (r > 1) gains.push(`${r === 2 ? 'Double the storage' : Number.isInteger(r) ? `${r} times the storage` : 'More storage'}: ${gb(to.storageGb)} instead of ${gb(from.storageGb)}`);
    else losses.push(`Less storage: ${gb(to.storageGb)} instead of ${gb(from.storageGb)}`);
  }

  const ca = from.specs;
  const cb = to.specs;
  if (ca && cb) {
    const cam: string[] = [];
    if (cb.mp >= ca.mp * 2) cam.push(`${cb.mp}MP main camera, up from ${ca.mp}MP`);
    if (cb.ultrawide && !ca.ultrawide) cam.push('adds an ultra-wide camera');
    if (cb.zoom && !ca.zoom) cam.push(`adds a ${cb.zoom}× zoom camera`);
    else if (cb.zoom >= ca.zoom + 1 && ca.zoom) cam.push(`longer zoom (${cb.zoom}× instead of ${ca.zoom}×)`);
    if (cam.length) gains.push(cam.join(', ').replace(/^./, (c) => c.toUpperCase()));
    const lost: string[] = [];
    if (ca.ultrawide && !cb.ultrawide) lost.push('no ultra-wide camera');
    if (ca.zoom && !cb.zoom) lost.push('no zoom camera');
    if (lost.length) losses.push(lost.join(', ').replace(/^./, (c) => c.toUpperCase()));

    // Battery size only compares fairly within one platform: iPhones do more with fewer mAh.
    if (ca.mah && cb.mah && (from.os === 'iOS') === (to.os === 'iOS')) {
      const r = cb.mah / ca.mah;
      if (r >= 1.12) gains.push(`Bigger battery: ${num(cb.mah)} mAh instead of ${num(ca.mah)} (when new)`);
      else if (r <= 0.88) losses.push(`Smaller battery: ${num(cb.mah)} mAh instead of ${num(ca.mah)} (when new)`);
    }
    if (cb.year - ca.year >= 1) gains.push(`${plural(cb.year - ca.year, 'year')} newer model (${cb.year})`);
  }

  const ga = GRADE[from.grade];
  const gbb = GRADE[to.grade];
  if (ga !== undefined && gbb !== undefined && ga !== gbb) {
    if (gbb > ga) gains.push(`Better condition: grade ${to.grade} instead of ${from.grade}`);
    else losses.push(`More signs of wear: grade ${to.grade} instead of ${from.grade}`);
  }
  // The difference a customer sees first when the two are side by side.
  if (from.screen && to.screen && Math.abs(to.screen - from.screen) >= (from.kind === 'tablet' ? 0.9 : 0.4)) {
    (to.screen > from.screen ? gains : losses).push(`${to.screen > from.screen ? 'Bigger' : 'Smaller'} screen: ${to.screen}″ instead of ${from.screen}″`);
  }
  return { gains, losses };
}

/**
 * Compare two products by their cheapest variants, without claiming a condition difference the
 * shelf contradicts: if the first also comes in the second's grade, grade is not a reason.
 */
export function diffProducts(from: Product, to: Product): Diff {
  const d = diff(from.head, to.head);
  const has = (p: Product, grade: string): boolean => p.items.some((v) => (GRADE[v.grade] ?? 0) >= (GRADE[grade] ?? 0));
  return {
    gains: has(from, to.head.grade) ? d.gains.filter((g) => !g.startsWith('Better condition')) : d.gains,
    losses: has(to, from.head.grade) ? d.losses.filter((l) => !l.startsWith('More signs of wear')) : d.losses,
  };
}

const family = (it: Item): string => `${it.kind}|${it.brand.toLowerCase() === 'apple' ? 'apple' : 'other'}`;
const modelKey = (it: Item): string => `${it.brand.toLowerCase()}|${stripNet(norm(it.model))}`;

export type StepKind = 'same' | 'small' | 'best' | 'swap';
export interface Step {
  kind: StepKind;
  product: Product;
  diff: Diff;
}

/**
 * Options for a customer who has already picked `base`:
 *   same  – the same model with more storage or in better condition
 *   small – the cheapest clearly better phone, within half the limit
 *   best  – the best phone within the limit
 *   swap  – something better for the same money or less
 */
export function stepUps(base: Product, all: Product[], limit: number): Step[] {
  const fam = family(base.head);
  const pool = all.filter((p) => p.key !== base.key && family(p.head) === fam);
  const dearer = pool.filter((p) => p.price > base.price && p.price <= base.price + limit);
  const steps: Step[] = [];
  const used = new Set<string>();
  const add = (kind: StepKind, p: Product | undefined): void => {
    if (!p || used.has(p.key)) return;
    const d = diffProducts(base, p);
    if (!d.gains.length) return;
    used.add(p.key);
    steps.push({ kind, product: p, diff: d });
  };

  const mk = modelKey(base.head);
  const sameModel = dearer
    .filter((p) => modelKey(p.head) === mk && p.head.storageGb >= base.head.storageGb && (GRADE[p.head.grade] ?? 0) >= (GRADE[base.head.grade] ?? 0))
    .sort((x, y) => x.price - y.price);
  const better = dearer.filter((p) => modelKey(p.head) !== mk && p.score >= base.score + 0.03);
  const best = [...better].sort((x, y) => y.score - x.score || x.price - y.price)[0];
  // Only a genuinely smaller step: cheaper than the best option, or it is not worth a rung.
  const small = better
    .filter((p) => p !== best && best !== undefined && p.price < best.price && p.price <= base.price + limit / 2 && p.score >= base.score + 0.05)
    .sort((x, y) => x.price - y.price)[0];
  add('same', sameModel[0]);
  add('small', small);
  add('best', best);
  steps.sort((x, y) => x.product.price - y.product.price);

  const swap = pool
    .filter((p) => p.price <= base.price && p.price >= base.price * 0.75 && p.score >= base.score + 0.08 && modelKey(p.head) !== mk)
    .sort((x, y) => y.score - x.score)[0];
  if (swap) {
    const d = diffProducts(base, swap);
    if (d.gains.length) steps.push({ kind: 'swap', product: swap, diff: d });
  }
  return steps;
}

export type FitType = 'phone' | 'iphone' | 'android' | 'ipad' | 'androidtab';
export interface FitNeeds {
  type: FitType;
  updates: boolean;
  /** Minimum storage in GB (0 = any). */
  storage: number;
  /** Grade A or B only. */
  tidy: boolean;
}

export const fitKind = (t: FitType): 'phone' | 'tablet' => (t === 'ipad' || t === 'androidtab' ? 'tablet' : 'phone');

function ofType(p: Product, t: FitType): boolean {
  const it = p.head;
  const apple = it.brand.toLowerCase() === 'apple';
  if (it.kind !== fitKind(t)) return false;
  if (t === 'iphone' || t === 'ipad') return apple;
  if (t === 'android' || t === 'androidtab') return !apple && it.os === 'Android';
  return true;
}

function meets(p: Product, n: FitNeeds): boolean {
  const it = p.head;
  if (n.updates && !getsUpdates(it.support)) return false;
  if (n.storage && it.storageGb < n.storage) return false;
  if (n.tidy && !p.items.some((v) => v.grade === 'A' || v.grade === 'B')) return false;
  return true;
}

export interface Fit {
  /** Cheaper than the pick, with what it gives up. */
  saver?: Product;
  /** Best match within the budget. */
  pick?: Product;
  /** Better, for a little over budget. */
  stretch?: Product;
  /** True when the saver does not meet the stated needs (nothing cheaper does). */
  saverCompromises: boolean;
  /** When nothing fits the budget: the cheapest item that meets the needs. */
  nearest?: Product;
}

export function fit(all: Product[], budget: number, limit: number, needs: FitNeeds): Fit {
  const pool = all.filter((p) => ofType(p, needs.type));
  const ok = pool.filter((p) => meets(p, needs));
  const byScore = (x: Product, y: Product): number => y.score - x.score || x.price - y.price;
  const pick = ok.filter((p) => p.price <= budget).sort(byScore)[0];
  const floor = pick?.score ?? 0;
  const stretch = ok.filter((p) => p.price > budget && p.price <= budget + limit && p.score >= floor + 0.04).sort(byScore)[0];
  let saver: Product | undefined;
  let saverCompromises = false;
  if (pick) {
    // A real saving, not a pound or two: at least a fifth cheaper than the pick.
    const cheaper = (list: Product[]): Product | undefined =>
      list.filter((p) => p.key !== pick.key && p.price <= pick.price * 0.8).sort((x, y) => x.price - y.price || y.score - x.score)[0];
    saver = cheaper(ok);
    if (!saver) {
      // Nothing cheaper meets the needs, so show what a saving would cost: the best of the
      // cheaper items, but not something so old it isn't a real alternative.
      saver = pool
        .filter((p) => p.key !== pick.key && p.price <= pick.price * 0.8 && p.price >= budget * 0.4 && diffProducts(p, pick).gains.length > 0)
        .sort(byScore)[0];
      saverCompromises = Boolean(saver);
    }
  }
  const nearest = pick ? undefined : [...ok].sort((x, y) => x.price - y.price)[0];
  return { saver, pick, stretch, saverCompromises, nearest };
}

/** One row of the side-by-side table. `best` is the index of the strongest cell, -1 for a tie. */
export interface Row {
  label: string;
  cells: string[];
  best: number;
}

export function compareRows(list: Product[], now: number): Row[] {
  const its = list.map((p) => p.head);
  const row = (label: string, text: (it: Item) => string, rank: (it: Item) => number): Row | null => {
    const cells = its.map(text);
    if (cells.every((c) => c === '—')) return null;
    const ranks = its.map(rank);
    const top = Math.max(...ranks);
    const winners = ranks.filter((r) => r === top).length;
    const at = ranks.indexOf(top);
    // Only mark a winner the reader can see: identical wording is a tie whatever the ranking says.
    const visible = cells.every((c, i) => i === at || c !== cells[at]);
    return { label, cells, best: winners === 1 && visible ? at : -1 };
  };
  const updText = (it: Item): string => {
    const s = it.support;
    if (s.status === 'ended') return 'Ended';
    if (s.status === 'unknown' || s.status === 'na') return 'Not known';
    return s.until ? `To ${s.est ? '~' : ''}${yearOf(s.until)}` : 'Yes';
  };
  const updRank = (it: Item): number => {
    const s = it.support;
    if (s.status === 'ended') return 0;
    if (s.status === 'unknown' || s.status === 'na') return 1;
    return s.until ? yearOf(s.until) : yearOf(now) + 2;
  };
  const rows = [
    row('Price', (it) => `£${it.price}`, (it) => -it.price),
    row('Updates', updText, updRank),
    row('Speed', (it) => it.perf?.label ?? '—', (it) => it.perf?.tier ?? 0),
    row('Storage', (it) => (it.storageGb ? gb(it.storageGb) : '—'), (it) => it.storageGb),
    row('Camera', (it) => (it.specs ? cameraText(it.specs) : '—'), (it) => cameraScore(it) ?? 0),
    row('Battery', (it) => (it.specs?.mah ? `${num(it.specs.mah)} mAh` : '—'), (it) => it.specs?.mah ?? 0),
    row('Screen', (it) => (it.screen ? `${it.screen}″` : '—'), (it) => it.screen),
    row('Condition', (it) => (it.grade ? `Grade ${it.grade}` : '—'), (it) => GRADE[it.grade] ?? 0),
  ];
  return rows.filter((r): r is Row => r !== null);
}
