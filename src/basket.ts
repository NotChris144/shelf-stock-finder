// The basket: what the customer at the counter is having, and what it comes to.
//
// Anything can go in from an opened card (or one copy of several), and the add-ons screen adds
// to the same basket. It is kept on the phone, so a reload or a spell in a pocket loses nothing,
// and it is emptied by hand. When it is opened, each line is checked against CeX again: a price
// that has changed since it went in is updated and says what it was, and anything no longer in
// stock at the branch says so.

import type { Item } from './types.ts';

export interface Line {
  id: string;
  /** "iPhone 12 64GB", or a game's or film's own name. */
  name: string;
  /** Colour and grade, where there are any. */
  detail: string;
  price: number;
  img: string;
  /** The price when it went in, once it has changed since. */
  was?: number;
  /** No longer listed in stock at the branch, as of the last check. */
  gone?: boolean;
}

const KEY = 'shelf.basket';

function read(): Line[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as Line[]).filter((l) => l && typeof l.id === 'string') : [];
  } catch {
    return [];
  }
}

let lines: Line[] = read();
const listeners = new Set<() => void>();

function changed(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    /* private mode or quota: it still works until the page closes */
  }
  for (const f of listeners) f();
}

/** A product as a basket line. */
export function lineOf(it: Item): Line {
  const name = it.kind === 'other' ? it.name.replace(/,?\s*\b[ABC]$/, '').replace(/\s+,/g, ',').trim() : `${it.title}${it.storage ? ' ' + it.storage.split(' ')[0] : ''}`;
  const detail = [it.kind === 'other' ? '' : it.variant, it.grade && `Grade ${it.grade}`].filter(Boolean).join(' · ');
  return { id: it.id, name, detail, price: it.price, img: it.img };
}

export const basket = {
  lines: (): readonly Line[] => lines,
  has: (id: string): boolean => lines.some((l) => l.id === id),
  count: (): number => lines.length,
  total: (): number => Math.round(lines.reduce((s, l) => s + l.price, 0) * 100) / 100,
  /** Newest last, as they would go on the counter. One of each product: CeX lists one entry per product. */
  add(it: Item): void {
    if (this.has(it.id)) return;
    lines = [...lines, lineOf(it)];
    changed();
  },
  remove(id: string): void {
    lines = lines.filter((l) => l.id !== id);
    changed();
  },
  clear(): void {
    lines = [];
    changed();
  },
  /** What CeX says now: the price, and whether the branch still lists it (`null` when CeX no longer has it at all). */
  recheck(now: Map<string, { price: number; here: boolean } | null>): void {
    let moved = false;
    lines = lines.map((l) => {
      if (!now.has(l.id)) return l;
      const n = now.get(l.id);
      const gone = !n?.here;
      const price = n?.price || l.price;
      if (gone === Boolean(l.gone) && price === l.price) return l;
      moved = true;
      const was = price === l.price ? l.was : (l.was ?? l.price);
      const next: Line = { ...l, price };
      // Back to what it went in at: nothing to say.
      if (was !== undefined && was !== price) next.was = was;
      else delete next.was;
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
  lines = read();
  for (const f of listeners) f();
});
