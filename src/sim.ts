// Simulated customers for the step-up flow. Development only: it is not part of the built app.
//
// Every phone and tablet in stock takes a turn as "the one they picked". For each, the options the
// flow would show are scored through the eyes of a dozen kinds of customer:
//   served – how often at least one option is a real improvement for them
//   harmed – how often an option shown makes things worse for them
//   missed – how much better the best phone in reach was than the best one shown (0 = nothing missed)
// Each is worked out twice: with no steer, and with "what matters most" set as staff would set it
// for that customer.
//
//   In the dev build's console:  await shelf.sim()        (or shelf.sim(100) for a £100 limit)

import { diffProducts, products, stepUps, type Aspect, type Diff, type Product, type Step } from './sell.ts';
import type { Item } from './types.ts';

export interface Persona {
  id: string;
  /** Who they are, as staff would describe them. */
  label: string;
  /** How much more (or less) than usual each kind of difference matters to them. */
  cares: Partial<Record<Aspect, number>>;
  /** How much every extra pound hurts: 0 not at all, 1 a lot. */
  thrift: number;
  /** Differences they count the other way round: a bigger screen is worse for someone who wants a small phone. */
  dislikes?: Aspect[];
  /** What staff would tap as "matters most" for them, if anything. */
  focus?: Aspect;
}

export const PERSONAS: Persona[] = [
  { id: 'everyday', label: 'No strong view, wants a sensible phone', cares: {}, thrift: 0.3 },
  { id: 'bargain', label: 'Counting every pound', cares: {}, thrift: 1 },
  { id: 'photos', label: 'Takes a lot of photos', cares: { camera: 3 }, thrift: 0.3, focus: 'camera' },
  { id: 'allday', label: 'Needs the battery to last all day', cares: { battery: 3, charging: 2 }, thrift: 0.3, focus: 'battery' },
  { id: 'gamer', label: 'Plays games, wants it fast', cares: { speed: 3, screen: 1.5 }, thrift: 0.2, focus: 'speed' },
  { id: 'keeper', label: 'Will keep it for years', cares: { updates: 3, newer: 1.5, tough: 1.5 }, thrift: 0.3, focus: 'updates' },
  { id: 'hoarder', label: 'Keeps every photo and app', cares: { storage: 3 }, thrift: 0.3, focus: 'storage' },
  { id: 'pocket', label: 'Wants a small phone', cares: { size: 3 }, thrift: 0.3, dislikes: ['size'] },
  { id: 'bigview', label: 'Wants a big, clear screen', cares: { size: 4, screen: 2 }, thrift: 0.3, focus: 'size' },
  { id: 'fussy', label: 'Wants it to look new', cares: { condition: 3 }, thrift: 0.3, focus: 'condition' },
  { id: 'clumsy', label: 'Hard on phones, or buying for a child', cares: { tough: 3, condition: 0.5 }, thrift: 0.6 },
  { id: 'commuter', label: 'Out all day on mobile data', cares: { network: 3, battery: 1.5 }, thrift: 0.3 },
];

/** A loss weighs on a customer more than the same-sized gain pleases them (as in sell.ts). */
const LOSS = 1.6;

/** What an option is worth to one kind of customer: above 0.25 is a real improvement, below 0 is worse. */
export function worth(d: Diff, delta: number, limit: number, who: Persona): number {
  let n = 0;
  for (const p of d.up) n += p.w * (who.cares[p.aspect] ?? 1) * (who.dislikes?.includes(p.aspect) ? -LOSS : 1);
  for (const p of d.down) n += p.w * (who.cares[p.aspect] ?? 1) * (who.dislikes?.includes(p.aspect) ? 1 : -LOSS);
  return n - who.thrift * 0.4 * Math.max(0, delta / limit);
}

export interface Outcome {
  served: string;
  harmed: string;
  missed: number;
}

export interface Report {
  /** Phones and tablets that took a turn as the pick. */
  picks: number;
  limit: number;
  /** How much of the shelf has a full spec sheet behind it. */
  withSheet: string;
  /** Share of picks with a step up inside the limit, and with anything at all to show. */
  inReach: string;
  anything: string;
  optionsPerPick: number;
  kinds: Record<string, number>;
  /** Average price step of the options inside the limit, in pounds. */
  avgStep: number;
  /** Options whose strongest reason is a slight one, and options that give up more than they add: both should be 0. */
  thinReason: number;
  losesMore: number;
  /** Per kind of customer, with no steer. */
  people: Record<string, Outcome>;
  /** The same, with "what matters most" set for the customers who have one. */
  told: Record<string, Outcome>;
  /** The picks where a customer was most let down, to read through. */
  worst: string[];
}

const family = (it: Item): string => `${it.kind}|${it.brand.toLowerCase() === 'apple' ? 'apple' : 'other'}`;
const pc = (n: number, of: number): string => (of ? `${Math.round((n / of) * 100)}%` : '–');
const name = (p: Product): string => `${p.head.title}${p.head.storage ? ' ' + p.head.storage.split(' ')[0] : ''} [${p.head.grade}] £${p.price}`;

export function simulate(items: Item[], limit = 60, now = Date.now()): Report {
  const all = products(items, now);
  const worst: { gap: number; text: string }[] = [];
  const blank = (): { served: number; harmed: number; shown: number; missed: number } => ({ served: 0, harmed: 0, shown: 0, missed: 0 });
  const plain = new Map(PERSONAS.map((p) => [p.id, blank()]));
  const told = new Map(PERSONAS.filter((p) => p.focus).map((p) => [p.id, blank()]));
  const kinds: Record<string, number> = {};
  let inReach = 0;
  let anything = 0;
  let count = 0;
  let thin = 0;
  let losing = 0;
  let stepSum = 0;

  for (const base of all) {
    // Everything this customer could have been shown: their kind of phone, up to the limit, not much cheaper.
    const reach = all.filter((p) => p.key !== base.key && family(p.head) === family(base.head) && p.price <= base.price + limit && p.price >= base.price * 0.75);
    const general = stepUps(base, all, limit);
    const ups = general.filter((s) => s.kind !== 'swap' && s.kind !== 'reach');
    if (ups.length) inReach++;
    if (general.length) anything++;
    count += ups.length;
    for (const s of general) {
      kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      if (ups.includes(s)) stepSum += s.product.price - base.price;
      if ((s.diff.up[0]?.w ?? 0) < 0.2) thin++;
      if (s.diff.down.reduce((n, p) => n + p.w, 0) >= s.diff.up.reduce((n, p) => n + p.w, 0)) losing++;
    }
    for (const who of PERSONAS) {
      let top = 0;
      let topP: Product | undefined;
      for (const p of reach) {
        const v = worth(diffProducts(base, p), p.price - base.price, limit, who);
        if (v > top) {
          top = v;
          topP = p;
        }
      }
      const judge = (shown: Step[], t: ReturnType<typeof blank>, note: boolean): void => {
        const scores = shown.map((s) => worth(s.diff, s.product.price - base.price, limit, who));
        const got = Math.max(0, ...scores);
        if (got >= 0.25) t.served++;
        t.shown += shown.length;
        t.harmed += scores.filter((x) => x < 0).length;
        t.missed += Math.max(0, top - got);
        if (note && topP && top - got > 0.5) {
          worst.push({ gap: top - got, text: `${who.id}: picked ${name(base)}; shown ${shown.map((s) => `${s.kind} ${name(s.product)}`).join(' | ') || 'nothing'}; best for them was ${name(topP)} (${diffProducts(base, topP).gains.slice(0, 2).join('; ')})` });
        }
      };
      judge(general, plain.get(who.id)!, !who.focus);
      if (who.focus) judge(stepUps(base, all, limit, who.focus), told.get(who.id)!, true);
    }
  }

  const outcome = (m: typeof plain): Record<string, Outcome> =>
    Object.fromEntries([...m].map(([id, t]) => [id, { served: pc(t.served, all.length), harmed: pc(t.harmed, t.shown), missed: Math.round((t.missed / all.length) * 100) / 100 }]));
  const mobile = items.filter((it) => it.kind === 'phone' || it.kind === 'tablet');
  return {
    picks: all.length,
    limit,
    withSheet: pc(mobile.filter((it) => it.specs?.sheet).length, mobile.length),
    inReach: pc(inReach, all.length),
    anything: pc(anything, all.length),
    optionsPerPick: Math.round((count / all.length) * 100) / 100,
    kinds,
    avgStep: Math.round(stepSum / Math.max(1, count)),
    thinReason: thin,
    losesMore: losing,
    people: outcome(plain),
    told: outcome(told),
    worst: worst.sort((x, y) => y.gap - x.gap).slice(0, 14).map((w) => `${w.gap.toFixed(2)} ${w.text}`),
  };
}
