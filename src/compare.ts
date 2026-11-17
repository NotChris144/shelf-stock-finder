// Compare: models set side by side, fact by fact, sized for a phone held in one hand.
//
// Phones, tablets and computers go in from an opened card, up to four at a time. The list is
// kept on the phone, so it carries across searches: an iPhone found in one search sits beside a
// Galaxy found in the next. On screen each fact is a row, its name above and the models' values
// in columns beneath, so no column of labels eats the width. Where one value is better it is set
// in full ink and the rest step back, and a figure that can be weighed gets a bar. Nothing is
// estimated: a fact nobody recorded is a dash.

import { waterTight } from './specs.ts';
import type { Hit, Item } from './types.ts';

export const COMPARE_MAX = 4;

export interface Entry {
  id: string;
  /** CeX's record, so the model is read again exactly as search reads it. */
  hit: Hit;
  /** No longer listed in stock at the branch, as of the last check. */
  gone?: boolean;
}

const KEY = 'shelf.compare';

function read(): Entry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Entry[]).filter((e) => e && typeof e.id === 'string' && e.hit).slice(0, COMPARE_MAX) : [];
  } catch {
    return [];
  }
}

let entries: Entry[] = read();
const listeners = new Set<() => void>();

function changed(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* private mode or quota: it still works until the page closes */
  }
  for (const f of listeners) f();
}

/** Games, films and accessories have no spec sheet to set side by side. */
export const comparable = (it: Item): boolean => it.kind !== 'other' && Boolean(it.raw);

export const comparing = {
  list: (): readonly Entry[] => entries,
  has: (id: string): boolean => entries.some((e) => e.id === id),
  count: (): number => entries.length,
  full: (): boolean => entries.length >= COMPARE_MAX,
  /** Newest on the right. `gone` for a model found on CeX that this branch hasn't got. */
  add(it: Item, gone = false): void {
    if (this.has(it.id) || this.full() || !it.raw) return;
    entries = [...entries, { id: it.id, hit: it.raw, ...(gone ? { gone: true } : {}) }];
    changed();
  },
  remove(id: string): void {
    entries = entries.filter((e) => e.id !== id);
    changed();
  },
  clear(): void {
    entries = [];
    changed();
  },
  /** What CeX says now: its record, and whether the branch still lists it (`null` when CeX no longer has it at all). */
  recheck(now: Map<string, { hit: Hit; here: boolean } | null>): void {
    let moved = false;
    entries = entries.map((e) => {
      if (!now.has(e.id)) return e;
      const n = now.get(e.id);
      const gone = !n?.here;
      const same = gone === Boolean(e.gone) && (!n || Number(n.hit.sellPrice) === Number(e.hit.sellPrice));
      if (same) return e;
      moved = true;
      const next: Entry = { ...e, ...(n ? { hit: n.hit } : {}) };
      if (gone) next.gone = true;
      else delete next.gone;
      return next;
    });
    if (moved) changed();
  },
  onChange(f: () => void): void {
    listeners.add(f);
  },
};

// Another tab or window on the same phone changed it.
window.addEventListener('storage', (ev) => {
  if (ev.key !== KEY) return;
  entries = read();
  for (const f of listeners) f();
});

// ------------------------------------------------------------------ the rows

export type Tone = 'ok' | 'warn' | 'ended' | 'unknown';

export interface Cell {
  text: string;
  /** Update status: shown as a dot in the status colour, beside the words. */
  tone?: Tone;
  /** 0..1 of the row's largest figure, for a bar under the value. */
  bar?: number;
}

export interface Row {
  label: string;
  cells: Cell[];
  /** Columns holding the better value; empty when none is better, or the difference can't be seen. */
  best: number[];
  /** Every column reads the same. */
  same: boolean;
}

export interface Section {
  title: string;
  rows: Row[];
}

/** One model's value in a row. `rank` decides the better one (higher wins); `n` sizes its bar. */
interface Fact {
  text: string;
  rank?: number;
  n?: number;
  tone?: Tone;
}

export const NONE = '—';
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const GRADE: Record<string, number> = { A: 3, B: 2, C: 1 };
const num = (n: number): string => n.toLocaleString('en-GB');
const gb = (n: number): string => (n >= 1024 ? `${n / 1024}TB` : `${n}GB`);
const hm = (minutes: number): string => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
const yearOf = (t: number): number => new Date(t).getUTCFullYear();
const yes = (on: boolean | undefined): Fact => ({ text: on ? 'Yes' : 'No', rank: on ? 1 : 0 });
const isMobile = (it: Item): boolean => it.kind === 'phone' || it.kind === 'tablet';

function row(label: string, its: Item[], fact: (it: Item) => Fact | null, bars = false): Row | null {
  const facts = its.map(fact);
  if (facts.every((f) => !f)) return null;
  const top = Math.max(...facts.map((f) => f?.n ?? 0));
  const known = facts.filter((f) => f?.n !== undefined).length;
  const cells: Cell[] = facts.map((f) => {
    if (!f) return { text: NONE };
    const c: Cell = { text: f.text };
    if (f.tone) c.tone = f.tone;
    // A bar needs something to be measured against.
    if (bars && f.n !== undefined && top > 0 && known > 1) c.bar = f.n / top;
    return c;
  });
  const ranks = facts.map((f) => f?.rank);
  const ranked = ranks.filter((r): r is number => r !== undefined);
  let best: number[] = [];
  if (ranked.length > 1) {
    const high = Math.max(...ranked);
    best = ranks.flatMap((r, i) => (r === high ? [i] : []));
    // All level, or a better one that reads the same as a worse one: nothing the reader could see.
    const reads = (i: number): string => cells[i].text;
    if (best.length === ranked.length || cells.some((_, i) => !best.includes(i) && best.some((b) => reads(b) === reads(i)))) best = [];
  }
  return { label, cells, best, same: cells.every((c) => c.text === cells[0].text) };
}

/** Whether it is still updated, and to when: the year where there is one. */
function updates(it: Item, now: number): Fact | null {
  const s = it.support;
  if (s.status === 'na') return null;
  if (s.status === 'ended') return { text: 'Ended', rank: 0, tone: 'ended' };
  if (s.status === 'unknown') return { text: 'Not known', rank: 1, tone: 'unknown' };
  if (s.stale) return { text: 'May have ended', rank: 1, tone: 'warn' };
  const tone: Tone = s.status === 'warn' ? 'warn' : 'ok';
  if (s.until) return { text: `Until ${s.est ? '~' : ''}${yearOf(s.until)}`, rank: yearOf(s.until), tone };
  // A computer's system, or a phone with no end date published.
  return { text: isMobile(it) ? 'Yes' : s.label, rank: yearOf(now) + 2, tone };
}

/** "A15 Bionic", "Snapdragon 8 Gen 2", "Core i5-1135G7": the chip without its maker or process size. */
function chipName(it: Item): string {
  const raw = it.specs?.sheet?.chip || it.perf?.chip || it.cpu || '';
  return raw
    .replace(/\s*\(.*?\)/g, '')
    .replace(/^(apple|google|qualcomm|samsung|mediatek)\s+/i, '')
    .replace(/\s+5G$/i, '')
    .trim();
}

function memory(it: Item): Fact | null {
  if (it.ramGb) return { text: gb(it.ramGb), rank: it.ramGb };
  const r = it.specs?.sheet?.ram;
  if (!r?.length) return null;
  // Came in more than one size: which this one has isn't known, so it can't be called better.
  return r.length === 1 ? { text: `${r[0]}GB`, rank: r[0] } : { text: `${r[0]}–${r[r.length - 1]}GB` };
}

/** "Android 9.0 (Pie)" -> "Android 9" */
const system = (s: string | undefined): string => (s ?? '').replace(/\s*\(.*?\)/g, '').replace(/\.0$/, '').trim();

/**
 * The facts worth setting side by side, in the order a customer asks about them. A row nobody
 * has a value for is left out, and so is a section with no rows.
 */
export function compareSections(its: Item[], now: number): Section[] {
  const sh = (it: Item) => it.specs?.sheet;
  // Battery capacity only weighs fairly within one platform: iPhones last as long on fewer mAh.
  const onePlatform = new Set(its.map((it) => it.os)).size === 1;
  const raw: [string, (Row | null)[]][] = [
    [
      'At a glance',
      [
        row('Condition', its, (it) => (it.grade ? { text: `Grade ${it.grade}`, rank: GRADE[it.grade] ?? 0 } : null)),
        row('Updates', its, (it) => updates(it, now)),
        row('Speed', its, (it) => (it.perf ? { text: it.perf.label, rank: it.perf.tier, n: it.perf.pct } : null), true),
        row('Storage', its, (it) => (it.storageGb ? { text: gb(it.storageGb), rank: it.storageGb } : null)),
      ],
    ],
    [
      'Screen',
      [
        row('Size', its, (it) => (it.screen ? { text: `${it.screen}″` } : null)),
        row('Panel', its, (it) => (sh(it)?.pan ? { text: sh(it)!.pan!, rank: sh(it)!.pan === 'OLED' ? 1 : 0 } : null)),
        // GSMArena only names the rate when it is above the usual 60Hz.
        row('Refresh rate', its, (it) => (sh(it) ? { text: `${sh(it)!.hz ?? 60}Hz`, rank: sh(it)!.hz ?? 60 } : null)),
        row('Brightest, tested', its, (it) => (sh(it)?.nits ? { text: `${num(sh(it)!.nits!)} nits`, rank: sh(it)!.nits, n: sh(it)!.nits } : null), true),
      ],
    ],
    [
      'Battery',
      [
        row('Battery test', its, (it) => (sh(it)?.act ? { text: hm(sh(it)!.act!), rank: sh(it)!.act, n: sh(it)!.act } : null), true),
        row('Endurance, older test', its, (it) => (sh(it)?.end ? { text: `${sh(it)!.end}h`, rank: sh(it)!.end, n: sh(it)!.end } : null), true),
        row(
          'Capacity when new',
          its,
          (it) => (it.specs?.mah ? { text: `${num(it.specs.mah)} mAh`, ...(onePlatform ? { rank: it.specs.mah, n: it.specs.mah } : {}) } : null),
          onePlatform,
        ),
        row('Charging', its, (it) => (sh(it)?.w ? { text: `${sh(it)!.w}W`, rank: sh(it)!.w, n: sh(it)!.w } : null), true),
        row('Wireless charging', its, (it) => {
          const s = sh(it);
          if (!s) return null;
          if (s.wl === undefined) return { text: 'No', rank: 0 };
          return s.wl ? { text: `${s.wl}W`, rank: 1 + s.wl / 1000 } : { text: 'Yes', rank: 1 };
        }),
      ],
    ],
    [
      'Camera',
      [
        // Megapixels say how big the pictures are, not how good: no winner.
        row('Main', its, (it) => (it.specs?.mp ? { text: `${it.specs.mp}MP` } : null)),
        row('Ultra-wide', its, (it) => (it.specs ? yes(it.specs.ultrawide) : null)),
        row('Zoom', its, (it) => (it.specs ? { text: it.specs.zoom ? `${it.specs.zoom}× optical` : 'None', rank: it.specs.zoom } : null)),
        row('Selfie', its, (it) => (sh(it)?.sf ? { text: `${sh(it)!.sf}MP` } : null)),
      ],
    ],
    [
      'Inside',
      [
        row('Chip', its, (it) => (chipName(it) ? { text: chipName(it) } : null)),
        row('Memory', its, memory),
        row('Geekbench 6', its, (it) => (sh(it)?.gb6 ? { text: num(sh(it)!.gb6!), rank: sh(it)!.gb6, n: sh(it)!.gb6 } : null), true),
        row('Geekbench 5', its, (it) => (sh(it)?.gb5 ? { text: num(sh(it)!.gb5!), rank: sh(it)!.gb5, n: sh(it)!.gb5 } : null), true),
        row('Graphics', its, (it) => (it.kind === 'laptop' || it.kind === 'desktop' ? { text: it.gpu ? 'Graphics card' : 'Built in', rank: it.gpu ? 1 : 0 } : null)),
      ],
    ],
    [
      'Build',
      [
        // A Wi-Fi tablet has no mobile network to speak of.
        row('5G', its, (it) => (it.kind === 'phone' && sh(it) ? yes(sh(it)!.g5 === 1) : null)),
        row('Water', its, (it) => {
          const s = sh(it);
          if (!s) return null;
          return s.ip ? { text: s.ip, rank: waterTight(s) ? 2 : 1 } : { text: 'Not rated', rank: 0 };
        }),
        row('USB-C', its, (it) => (sh(it) ? yes(sh(it)!.usbc === 1) : null)),
        row('Memory card', its, (it) => (sh(it) ? yes(sh(it)!.sd === 1) : null)),
        row('Headphone socket', its, (it) => (sh(it) ? yes(sh(it)!.jack === 1) : null)),
        row('Contactless', its, (it) => (sh(it) ? yes(sh(it)!.nfc === 1) : null)),
        row('Weight', its, (it) => (sh(it)?.wt ? { text: `${sh(it)!.wt}g` } : null)),
      ],
    ],
    [
      'Software',
      [
        row('Launched with', its, (it) => (sh(it)?.os ? { text: system(sh(it)!.os) } : null)),
        row('Upgradable to', its, (it) => (sh(it)?.up ? { text: system(sh(it)!.up) } : null)),
        row('System', its, (it) => (it.kind === 'laptop' || it.kind === 'desktop' ? (it.os ? { text: it.os } : null) : null)),
        row('Released', its, (it) => {
          const s = it.specs;
          if (!s?.year) return null;
          const m = s.sheet?.m;
          return { text: `${m ? `${MONTH[m - 1]} ` : ''}${s.year}`, rank: s.year * 12 + (m ?? 6) };
        }),
      ],
    ],
  ];
  return raw.map(([title, rows]) => ({ title, rows: rows.filter((r): r is Row => r !== null) })).filter((s) => s.rows.length);
}
