// The add-on audit: every product in a branch's stock run through the add-on rules and the guard
// (src/addons.ts), so the suggestions are checked by the code rather than by someone reading them.
//
// It reports:
//   - blocked:   accessories a rule let through but the guard stopped. Each one is a rule that is
//                too loose, or (marked "listing") a product CeX has filed under the wrong console.
//                Nothing here ever reaches the screen, but a loose rule should be tightened.
//   - uncovered: kinds of product in stock with no add-ons set up, largest first. Accessory
//                categories (the things being suggested) are left out of this list.
//   - empty:     slots that found nothing in stock for a product. Usually the shelf is simply out
//                of that thing; a slot that is empty for everything may be too strict.
//   - unsure:    picks shown as "Check it fits", by slot. Many in one slot means its fit rule
//                can't tell from the names and could be taught more.
//   - offers:    for one product of each kind, what it would be offered, to read at a glance.
//
// Run it on the live stock with `npm run addonaudit`, or `await shelf.audit()` in the dev build.

import { arrange, byCategory, slotsFor } from './addons.ts';
import type { Item } from './types.ts';

export interface AuditReport {
  /** Distinct products looked at (colours and grades of one product count once). */
  products: number;
  /** Of those, how many have add-ons set up. */
  covered: number;
  blocked: { why: string; offer: string; slot: string; times: number; example: string }[];
  uncovered: [string, number][];
  empty: [string, number][];
  unsure: [string, number][];
  offers: Record<string, string[]>;
}

const productKey = (it: Item): string => `${it.category}|${it.name.replace(/,?\s*\b[ABC]$/, '').trim()}`;

export function audit(stock: Item[]): AuditReport {
  const index = byCategory(stock);
  const done = new Set<string>();
  const suggests = new Set<string>();
  const uncovered = new Map<string, number>();
  const blocked = new Map<string, AuditReport['blocked'][number]>();
  const empty = new Map<string, number>();
  const unsure = new Map<string, number>();
  const offers: Record<string, string[]> = {};
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  let products = 0;
  let covered = 0;

  for (const it of stock) {
    const key = productKey(it);
    if (done.has(key)) continue;
    done.add(key);
    products++;
    const slots = slotsFor(it);
    if (!slots.length) {
      bump(uncovered, it.category);
      continue;
    }
    covered++;
    for (const s of slots) for (const c of s.cats) suggests.add(c);
    const shelves = arrange(it, slots, index, (slot, a, why) => {
      const k = `${why}|${a.name}|${slot.title}`;
      const had = blocked.get(k);
      if (had) had.times++;
      else blocked.set(k, { why, offer: a.name, slot: slot.title, times: 1, example: it.name });
    });
    const filled = new Set(shelves.map((s) => s.slot.id));
    for (const s of slots) if (!filled.has(s.id)) bump(empty, `${it.category} › ${s.title}`);
    for (const sh of shelves) for (const o of sh.offers) if (o.fit === 'check') bump(unsure, sh.slot.title);
    if (!offers[it.category]) {
      offers[it.category] = [`${it.name} (£${it.price})`, ...shelves.map((sh) => `  ${sh.slot.title}: ${sh.offers.map((o) => `${o.item.name} £${o.item.price}${o.fit === 'check' ? ' [check]' : ''}`).join(' | ')}`)];
    }
  }

  const desc = (m: Map<string, number>): [string, number][] => [...m].sort((a, b) => b[1] - a[1]);
  return {
    products,
    covered,
    blocked: [...blocked.values()].sort((a, b) => b.times - a.times),
    uncovered: desc(uncovered).filter(([c]) => !suggests.has(c)),
    empty: desc(empty),
    unsure: desc(unsure),
    offers,
  };
}

/** The report as plain text, for the console or a terminal. */
export function auditText(r: AuditReport, store: string): string {
  const lines: string[] = [];
  const list = (title: string, rows: string[], none: string): void => {
    lines.push('', `${title}`);
    lines.push(...(rows.length ? rows.map((r) => `  ${r}`) : [`  ${none}`]));
  };
  lines.push(`Add-on audit, ${store}: ${r.products} products, ${r.covered} with add-ons set up.`);
  const row = (b: AuditReport['blocked'][number]): string => `${b.why.replace(/^listing: /, '')}: "${b.offer}" as ${b.slot} (${b.times}×, e.g. ${b.example})`;
  const rules = r.blocked.filter((b) => !b.why.startsWith('listing: '));
  const listings = r.blocked.filter((b) => b.why.startsWith('listing: '));
  list(`Stopped by the guard: rules to tighten (${rules.length})`, rules.slice(0, 40).map(row), 'none');
  list(`Stopped by the guard: CeX listed under the wrong console (${listings.length})`, listings.slice(0, 20).map(row), 'none');
  list('No add-ons set up, by kind of product', r.uncovered.slice(0, 25).map(([c, n]) => `${c}: ${n}`), 'none');
  list('Slots with nothing in stock', r.empty.slice(0, 25).map(([k, n]) => `${k}: ${n}`), 'none');
  list('"Check it fits" picks, by slot', r.unsure.map(([k, n]) => `${k}: ${n}`), 'none');
  lines.push('', 'What one of each kind is offered');
  for (const rows of Object.values(r.offers)) lines.push(...rows.map((x) => `  ${x}`));
  return lines.join('\n');
}
