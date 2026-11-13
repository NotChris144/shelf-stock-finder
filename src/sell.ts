// Recommendation logic: which in-stock item is a worthwhile step up from another, and why.
//
// Every reason produced here is a fact that is true of both items. If nothing concrete is better,
// no step up is offered — the screen is shown to customers, so it has to hold up when read.

import { norm } from './eol.ts';
import { cameraText, waterTight } from './specs.ts';
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

/** What a difference between two phones is about. */
export type Aspect = 'updates' | 'speed' | 'storage' | 'camera' | 'battery' | 'charging' | 'screen' | 'network' | 'tough' | 'ports' | 'sound' | 'condition' | 'newer' | 'size';

/** One difference, with how much it should count towards choosing: 0 (barely) to 1 (decisive). */
export interface Point {
  aspect: Aspect;
  text: string;
  w: number;
}

export interface Diff {
  /** What `to` does better than `from`, most persuasive first. */
  gains: string[];
  /** What it gives up. */
  losses: string[];
  /** The same, with the weight behind each line. */
  up: Point[];
  down: Point[];
}

const GRADE: Record<string, number> = { A: 1, B: 0.65, C: 0.25 };

/** Is it receiving updates today? Amber counts only when the end is still ahead. */
export const getsUpdates = (s: Item['support']): boolean => s.status === 'ok' || (s.status === 'warn' && !s.stale);

function cameraScore(it: Item): number | null {
  const s = it.specs;
  // Nobody picks a tablet for its camera, and only some tablets have a sheet to judge it by.
  if (!s || it.kind !== 'phone') return null;
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
  // Phones only: just some tablets have a sheet, and those would outrank the rest for it.
  const mah = it.kind === 'phone' ? (it.specs?.mah ?? 0) : 0;
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

const hm = (minutes: number): string => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
/** 0.37 -> "35%" */
const pct5 = (x: number): string => `${Math.max(5, Math.round((x * 100) / 5) * 5)}%`;
const cap = (s: string): string => s.replace(/^./, (ch) => ch.toUpperCase());

/** How far a ratio above 1 should count: 1.15 a little, 2 a lot, 3 and over fully. */
const byRatio = (r: number): number => clamp(Math.log2(r) / 1.6, 0.12, 1);

/**
 * Facts that separate two items, phrased from the point of view of moving from `from` to `to`.
 * Where GSMArena has tested both phones the measured result is used; otherwise the spec sheet.
 * `focus` is what this customer cares about most: it leads the list.
 */
export function diff(from: Item, to: Item, focus?: Aspect): Diff {
  const up: Point[] = [];
  const down: Point[] = [];
  const gain = (aspect: Aspect, w: number, text: string): void => void up.push({ aspect, w, text });
  const lose = (aspect: Aspect, w: number, text: string): void => void down.push({ aspect, w, text });
  const a = from.support;
  const b = to.support;
  const live = getsUpdates;

  if (live(b) && a.status === 'ended') {
    gain('updates', 1, `Still gets software updates${b.until ? ` until ${b.est ? 'about ' : ''}${yearOf(b.until)}` : ''}; the ${from.title} no longer does`);
  } else if (live(b) && (a.status === 'unknown' || a.stale)) {
    gain('updates', 0.55, `Software updates confirmed${b.until ? ` until ${b.est ? 'about ' : ''}${yearOf(b.until)}` : ''}; not confirmed for the ${from.title}`);
  } else if (live(a) && (b.status === 'ended' || b.stale)) {
    lose('updates', 1, 'No longer gets software updates');
  } else if (a.status === 'unknown' && b.status === 'ended') {
    lose('updates', 0.5, 'No longer gets software updates');
  } else if (live(a) && b.status === 'unknown') {
    lose('updates', 0.5, 'Software updates are not confirmed for it');
  } else if (live(a) && live(b) && a.until && b.until) {
    // Counted from the two years printed beside it, so the reader's own subtraction agrees.
    const years = yearOf(b.until) - yearOf(a.until);
    const approx = a.est || b.est ? 'About ' : '';
    if (years >= 1) gain('updates', clamp(0.2 + 0.2 * years, 0, 0.9), `${approx}${plural(years, 'more year')} of updates (to ${yearOf(b.until)} instead of ${yearOf(a.until)})`);
    else if (years <= -1) lose('updates', clamp(0.2 + 0.2 * -years, 0, 0.9), `${approx}${plural(-years, 'fewer year')} of updates (to ${yearOf(b.until)})`);
  }

  const sa = from.specs?.sheet;
  const sb = to.specs?.sheet;

  // Speed: the same benchmark run on both phones beats an estimate from the chip.
  const tested = sa?.gb6 && sb?.gb6 ? sb.gb6 / sa.gb6 : sa?.gb5 && sb?.gb5 ? sb.gb5 / sa.gb5 : 0;
  const speed = tested || (from.perf && to.perf ? to.perf.score / from.perf.score : 0);
  if (speed) {
    const how = tested ? " in GSMArena's speed test" : '';
    if (speed >= 2.7) gain('speed', byRatio(speed), `About ${Math.round(speed)} times as fast${how}`);
    else if (speed >= 1.8) gain('speed', byRatio(speed), `About twice as fast${how}`);
    else if (speed >= 1.15) gain('speed', byRatio(speed), `About ${pct5(speed - 1)} faster${how}`);
    else if (speed <= 0.87) lose('speed', byRatio(1 / speed), `Slower${how} (about ${pct5(1 - speed)} less speed)`);
  }

  if (from.storageGb && to.storageGb && from.storageGb !== to.storageGb) {
    const r = to.storageGb / from.storageGb;
    const w = clamp(0.3 + 0.25 * Math.abs(Math.log2(r)));
    if (r > 1) gain('storage', w, `${r === 2 ? 'Double the storage' : Number.isInteger(r) ? `${r} times the storage` : 'More storage'}: ${gb(to.storageGb)} instead of ${gb(from.storageGb)}`);
    else lose('storage', w, `Less storage: ${gb(to.storageGb)} instead of ${gb(from.storageGb)}`);
  }

  const ca = from.specs;
  const cb = to.specs;
  if (ca && cb) {
    if (from.kind === 'phone' && to.kind === 'phone') {
      const cam: string[] = [];
      let w = 0;
      if (cb.mp >= ca.mp * 2) (cam.push(`${cb.mp}MP main camera, up from ${ca.mp}MP`), (w += 0.25));
      if (cb.ultrawide && !ca.ultrawide) (cam.push('adds an ultra-wide camera'), (w += 0.3));
      if (cb.zoom && !ca.zoom) (cam.push(`adds a ${cb.zoom}× zoom camera`), (w += 0.4));
      else if (cb.zoom >= ca.zoom + 1 && ca.zoom) (cam.push(`longer zoom (${cb.zoom}× instead of ${ca.zoom}×)`), (w += 0.2));
      if (cam.length) gain('camera', Math.min(0.9, w), cap(cam.join(', ')));
      const lost: string[] = [];
      let lw = 0;
      if (ca.ultrawide && !cb.ultrawide) (lost.push('no ultra-wide camera'), (lw += 0.3));
      if (ca.zoom && !cb.zoom) (lost.push('no zoom camera'), (lw += 0.35));
      else if (cb.zoom && cb.zoom <= ca.zoom - 1) (lost.push(`shorter zoom (${cb.zoom}× instead of ${ca.zoom}×)`), (lw += 0.2));
      if (cb.mp * 2 <= ca.mp) (lost.push(`${cb.mp}MP main camera, down from ${ca.mp}MP`), (lw += 0.2));
      if (lost.length) lose('camera', lw, cap(lost.join(', ')));
    }

    // Battery: hours in the same test, where both were tested. Failing that, capacity, which
    // only compares fairly within one platform: iPhones do more with fewer mAh.
    if (sa?.act && sb?.act) {
      const hours = (sb.act - sa.act) / 60;
      if (hours >= 1) gain('battery', clamp(0.2 + hours * 0.15), `Lasts longer: ${hm(sb.act)} of active use in GSMArena's battery test, against ${hm(sa.act)}`);
      else if (hours <= -1) lose('battery', clamp(0.2 + -hours * 0.15), `Shorter battery life: ${hm(sb.act)} of active use in GSMArena's test, against ${hm(sa.act)}`);
    } else if (sa?.end && sb?.end) {
      const r = sb.end / sa.end;
      if (r >= 1.15) gain('battery', clamp(0.2 + (r - 1) * 1.2), `Lasts longer: endurance rating of ${sb.end}h in GSMArena's battery test, against ${sa.end}h`);
      else if (r <= 0.87) lose('battery', clamp(0.2 + (1 / r - 1) * 1.2), `Shorter battery life: endurance rating of ${sb.end}h in GSMArena's test, against ${sa.end}h`);
    } else if (ca.mah && cb.mah && (from.os === 'iOS') === (to.os === 'iOS')) {
      const r = cb.mah / ca.mah;
      if (r >= 1.12) gain('battery', clamp(0.15 + (r - 1)), `Bigger battery: ${num(cb.mah)} mAh instead of ${num(ca.mah)} (when new)`);
      else if (r <= 0.88) lose('battery', clamp(0.15 + (1 / r - 1)), `Smaller battery: ${num(cb.mah)} mAh instead of ${num(ca.mah)} (when new)`);
    }
    if (cb.year - ca.year >= 1) gain('newer', clamp(0.1 * (cb.year - ca.year), 0, 0.5), `${plural(cb.year - ca.year, 'year')} newer model (${cb.year})`);
    else if (ca.year - cb.year >= 1) lose('newer', clamp(0.08 * (ca.year - cb.year), 0, 0.4), `${plural(ca.year - cb.year, 'year')} older model (${cb.year})`);
  }

  // Features are only compared when both have a full spec sheet, so "has" and "has not" are both known.
  if (sa && sb) {
    if (sb.g5 && !sa.g5) gain('network', 0.45, `Has 5G; the ${from.title} is 4G only`);
    else if (sa.g5 && !sb.g5) lose('network', 0.45, '4G only, no 5G');

    const screen: string[] = [];
    let w = 0;
    if (sb.pan === 'OLED' && sa.pan === 'LCD') (screen.push('OLED instead of LCD (deeper blacks, richer colour)'), (w += 0.4));
    if ((sb.hz ?? 60) >= 90 && (sa.hz ?? 60) < 90) (screen.push(`smoother ${sb.hz}Hz scrolling`), (w += 0.3));
    if (sa.nits && sb.nits && sb.nits >= sa.nits * 1.3) (screen.push(`brighter outdoors (${num(sb.nits)} nits measured, against ${num(sa.nits)})`), (w += 0.25));
    if (screen.length) gain('screen', Math.min(0.9, w), `Better screen: ${screen.join(', ')}`);
    const worse: string[] = [];
    let lw = 0;
    if (sa.pan === 'OLED' && sb.pan === 'LCD') (worse.push('LCD instead of OLED'), (lw += 0.4));
    if ((sa.hz ?? 60) >= 90 && (sb.hz ?? 60) < 90) (worse.push(`${sb.hz ?? 60}Hz instead of ${sa.hz}Hz`), (lw += 0.25));
    if (worse.length) lose('screen', lw, `Plainer screen: ${worse.join(', ')}`);

    const power: string[] = [];
    let pw = 0;
    if (sa.w && sb.w && sb.w >= sa.w * 1.5) (power.push(`faster charging (${sb.w}W instead of ${sa.w}W)`), (pw += 0.25));
    if (sb.wl !== undefined && sa.wl === undefined) (power.push('wireless charging'), (pw += 0.2));
    if (power.length) gain('charging', pw, cap(power.join(', ')));
    else if (sa.wl !== undefined && sb.wl === undefined) lose('charging', 0.15, 'No wireless charging');

    if (waterTight(sb) && !waterTight(sa)) gain('tough', 0.35, `Water resistant (${sb.ip})`);
    else if (waterTight(sa) && !waterTight(sb)) lose('tough', 0.3, 'Not water resistant');

    const gone: string[] = [];
    let gw = 0;
    if (sa.sd && !sb.sd) (gone.push('no memory card slot'), (gw += 0.25));
    if (sa.jack && !sb.jack) (gone.push('no headphone socket'), (gw += 0.2));
    if (gone.length) lose('ports', gw, cap(gone.join(', ')));

    // LUFS: nearer zero is louder; 3 is a difference you can hear across a room.
    if (sa.lufs && sb.lufs && sb.lufs - sa.lufs >= 3) gain('sound', 0.15, "Louder speaker in GSMArena's test");
  }

  const ga = GRADE[from.grade];
  const gbb = GRADE[to.grade];
  if (ga !== undefined && gbb !== undefined && ga !== gbb) {
    const w = clamp(Math.abs(gbb - ga) * 0.85, 0.3, 0.65);
    if (gbb > ga) gain('condition', w, `Better condition: grade ${to.grade} instead of ${from.grade}`);
    else lose('condition', w, `More signs of wear: grade ${to.grade} instead of ${from.grade}`);
  }
  // The difference a customer sees first when the two are side by side. It is a matter of taste,
  // so it is stated but never the reason an option is chosen.
  if (from.screen && to.screen && Math.abs(to.screen - from.screen) >= (from.kind === 'tablet' ? 0.9 : 0.4)) {
    if (to.screen > from.screen) gain('size', 0.12, `Bigger screen: ${to.screen}″ instead of ${from.screen}″`);
    else lose('size', 0.12, `Smaller screen: ${to.screen}″ instead of ${from.screen}″`);
  }
  return order({ up, down, gains: [], losses: [] }, focus);
}

/** Most persuasive first, with what this customer cares about ahead of everything else. */
function order(d: Diff, focus?: Aspect): Diff {
  const rank = (p: Point): number => p.w + (p.aspect === focus ? 2 : 0);
  d.up.sort((x, y) => rank(y) - rank(x));
  d.down.sort((x, y) => rank(y) - rank(x));
  d.gains = d.up.map((p) => p.text);
  d.losses = d.down.map((p) => p.text);
  return d;
}

/**
 * Compare two products by their cheapest variants. Better condition is not claimed as a reason
 * when the first also comes in the second's grade. Worse condition is always stated, because the
 * price shown is for that copy.
 */
export function diffProducts(from: Product, to: Product, focus?: Aspect): Diff {
  const d = diff(from.head, to.head, focus);
  const has = (p: Product, grade: string): boolean => p.items.some((v) => (GRADE[v.grade] ?? 0) >= (GRADE[grade] ?? 0));
  if (has(from, to.head.grade)) d.up = d.up.filter((p) => p.aspect !== 'condition');
  return order(d, focus);
}

/** How much better on balance a different phone has to be before it is worth a customer's time. */
const CLEAR = 0.45;

/** What is given up counts for more than what is gained: nobody thanks you for a trade-off they did not expect. */
const LOSS = 1.6;

/**
 * How much better `d` makes things overall: the weights of what is gained less what is lost.
 * Above about 0.3 is worth a customer's attention; above 1 is a different class of phone.
 */
export function uplift(d: Diff, focus?: Aspect): number {
  const f = (p: Point): number => p.w * (p.aspect === focus ? 3 : 1);
  return d.up.reduce((n, p) => n + f(p), 0) - LOSS * d.down.reduce((n, p) => n + f(p), 0);
}

const family = (it: Item): string => `${it.kind}|${it.brand.toLowerCase() === 'apple' ? 'apple' : 'other'}`;
// The 4G and 5G versions of a model are different phones inside, so the network stays in the name.
const modelKey = (it: Item): string => `${it.brand.toLowerCase()}|${norm(it.model)}`;

export type StepKind = 'same' | 'value' | 'focus' | 'best' | 'reach' | 'swap';
export interface Step {
  kind: StepKind;
  product: Product;
  diff: Diff;
  /** Overall improvement on the pick (see `uplift`). */
  gain: number;
}

/**
 * A step is only worth showing with one solid reason behind it, not a pile of small ones. Screen
 * size is taste, so it only counts as a reason for a customer who asked for a bigger screen.
 */
const solid = (d: Diff, focus?: Aspect): boolean => d.up.some((p) => (p.w >= 0.2 && p.aspect !== 'size') || (p.aspect === 'size' && focus === 'size'));

/** Losses no gain makes up for: updates ending, a phone that feels clearly slower, or less of the one thing they asked about. */
const dealBreaker = (d: Diff, focus?: Aspect): boolean =>
  d.down.some((p) => (p.aspect === 'updates' && p.w >= 0.9) || (p.aspect === 'speed' && p.w >= 0.35) || (focus !== undefined && p.aspect === focus));

/**
 * They chose a phone of a certain size on purpose. One that is a good deal bigger or smaller is a
 * different kind of phone to hold, so it has to earn its place by more than a like-sized one.
 */
function sizeShift(from: Item, to: Item, focus?: Aspect): number {
  if (focus === 'size' || from.kind !== 'phone' || !from.screen || !to.screen) return 0;
  const by = Math.abs(to.screen - from.screen);
  return by >= 0.9 ? 0.3 : by >= 0.5 ? 0.15 : 0;
}

/**
 * Options for a customer who has already picked `base`, each measured against that pick:
 *   same  – the same model with more storage or in better condition (the easy yes)
 *   value – the most improvement for each extra pound
 *   best  – the most improvement the limit allows
 *   focus – the best for the one thing they said matters most, when `best` is not it
 *   reach – when nothing within the limit is worth it: the nearest real improvement beyond it
 *   swap  – something better for the same money or less
 * An option has to be better on balance after its losses are counted. It is never one that drops
 * updates or is clearly slower, and a phone whose updates have ended has to be much better to be
 * suggested at all. `focus` tilts every choice towards what this customer cares about.
 */
export function stepUps(base: Product, all: Product[], limit: number, focus?: Aspect): Step[] {
  const fam = family(base.head);
  const mk = modelKey(base.head);
  const cond = (it: Item): number => GRADE[it.grade] ?? 0;
  // Like is set beside like: each other phone is represented by its cheapest copy in at least
  // the pick's condition, so a step up is not quietly paid for in scratches. Only when it has
  // no such copy is the worn one offered, and then the wear is stated.
  const beside = (p: Product): Product => {
    const ok = p.items.filter((i) => cond(i) >= cond(base.head));
    return ok.length && ok[0] !== p.head ? { ...p, items: ok, head: ok[0], price: ok[0].price } : p;
  };
  // The easiest step of all: the very same phone in better condition.
  const tidier = base.items.filter((i) => cond(i) > cond(base.head)).sort((x, y) => x.price - y.price);
  const ownBetter: Product[] = tidier.length ? [{ ...base, key: `${base.key}|tidier`, items: tidier, head: tidier[0], price: tidier[0].price }] : [];
  const judged = [...ownBetter, ...all.filter((p) => p.key !== base.key && family(p.head) === fam).map(beside)]
    .map((p) => {
      // Within the pick's own group the better grade is the whole point, so it is not filtered out.
      const d = ownBetter.includes(p) ? diff(base.head, p.head, focus) : diffProducts(base, p, focus);
      const same = modelKey(p.head) === mk;
      // Selling someone a phone that is already out of updates takes a good reason.
      const stale = !same && p.head.support.status === 'ended' ? 0.3 : 0;
      return { p, d, same, gain: uplift(d, focus) - sizeShift(base.head, p.head, focus) - stale, delta: p.price - base.price };
    })
    // A different model is only suggested when its speed or its specs are on record: one fact
    // about a phone nothing else is known of is not a recommendation.
    .filter((x) => solid(x.d, focus) && !dealBreaker(x.d, focus) && (x.same || x.p.head.perf !== null || x.p.head.specs !== null));
  type Judged = (typeof judged)[number];
  const steps: Step[] = [];
  const add = (kind: StepKind, x: Judged | undefined): void => {
    if (x && !steps.some((s) => s.product.key === x.p.key)) steps.push({ kind, product: x.p, diff: x.d, gain: x.gain });
  };
  const byGain = (x: Judged, y: Judged): number => y.gain - x.gain || x.delta - y.delta;
  const asked = (x: Judged): boolean => x.d.up.some((p) => p.aspect === focus);
  const otherModel = (x: Judged, than: Judged): boolean => modelKey(x.p.head) !== modelKey(than.p.head);

  const dearer = judged.filter((x) => x.delta > 0 && x.delta <= limit);
  // The same phone, bigger or tidier: nothing is given up, so any gain will do. Of those, the
  // one that gives most for each pound.
  const same = dearer
    .filter((x) => x.same && x.p.head.storageGb >= base.head.storageGb && cond(x.p.head) >= cond(base.head) && !x.d.down.length)
    .sort((x, y) => y.gain / (y.delta + 15) - x.gain / (x.delta + 15))[0];
  // A different phone has to be clearly better on balance: more than one modest reason's worth.
  const others = dearer.filter((x) => !x.same && x.gain >= CLEAR);
  const best = [...others].sort(byGain)[0];
  // What they asked about, if the best all-round option does not improve it.
  const forFocus = focus && best && !asked(best) ? others.filter((x) => asked(x) && otherModel(x, best)).sort(byGain)[0] : undefined;
  // Value: improvement per pound, with a few pounds of ballast so a £2 step with one small gain
  // does not win. It has to be a real saving on the best option and still a real improvement.
  const value =
    best && !forFocus
      ? others
          .filter((x) => x !== best && otherModel(x, best) && x.delta <= best.delta * 0.75 && x.gain >= Math.max(CLEAR, best.gain * 0.4))
          .sort((x, y) => y.gain / (y.delta + 15) - x.gain / (x.delta + 15))[0]
      : undefined;
  add('same', same);
  add('value', value);
  add('focus', forFocus);
  add('best', best);
  // Nothing in reach: rather than a shrug, the nearest step that is really worth taking.
  if (!steps.length) {
    add(
      'reach',
      judged.filter((x) => x.delta > limit && x.delta <= limit * 3 && x.gain >= 0.5 && (!x.same || !x.d.down.length)).sort((x, y) => x.delta - y.delta || y.gain - x.gain)[0],
    );
  }
  steps.sort((x, y) => x.product.price - y.product.price);

  const swap = judged.filter((x) => !x.same && x.delta <= 0 && x.p.price >= base.price * 0.75 && x.gain >= 0.35).sort(byGain)[0];
  if (swap && !steps.some((s) => s.product.key === swap.p.key)) steps.push({ kind: 'swap', product: swap.p, diff: swap.d, gain: swap.gain });
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
    row('Camera', (it) => (it.specs && it.kind === 'phone' ? cameraText(it.specs) : '—'), (it) => cameraScore(it) ?? 0),
    // Hours in GSMArena's test where every phone in the table has been tested; capacity otherwise.
    its.every((it) => it.specs?.sheet?.act)
      ? row('Battery', (it) => `${hm(it.specs!.sheet!.act!)} in testing`, (it) => it.specs?.sheet?.act ?? 0)
      : row('Battery', (it) => (it.specs?.mah ? `${num(it.specs.mah)} mAh` : '—'), (it) => it.specs?.mah ?? 0),
    row('Screen', (it) => (it.screen ? [`${it.screen}″`, it.specs?.sheet?.pan, (it.specs?.sheet?.hz ?? 0) >= 90 && `${it.specs?.sheet?.hz}Hz`].filter(Boolean).join(' ') : '—'), (it) => it.screen),
    // Yes or no only where the sheet says so; a model without a sheet shows a dash, not a guess.
    row('5G', (it) => (it.specs?.sheet ? (it.specs.sheet.g5 ? 'Yes' : 'No') : '—'), (it) => (it.specs?.sheet?.g5 ? 1 : 0)),
    row('Condition', (it) => (it.grade ? `Grade ${it.grade}` : '—'), (it) => GRADE[it.grade] ?? 0),
  ];
  return rows.filter((r): r is Row => r !== null);
}
