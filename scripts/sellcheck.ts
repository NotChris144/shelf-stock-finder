// Prints the recommendations the sales flows would make from the sample listings:  node scripts/sellcheck.ts
import snapshot from '../src/data/eol-snapshot.json' with { type: 'json' };
import sheets from '../src/data/specs.json' with { type: 'json' };
import { DEMO_HITS } from '../src/demo.ts';
import type { EolDb } from '../src/eol.ts';
import { toItem } from '../src/parse.ts';
import { diff, fit, products, stepUps } from '../src/sell.ts';
import { useSheets, type SheetFile } from '../src/specs.ts';
import { makeCtx } from '../src/support.ts';

useSheets(sheets as unknown as SheetFile);
const ctx = makeCtx(snapshot as unknown as EolDb);
const all = products(DEMO_HITS.map((h, i) => toItem(h, i, ctx)), ctx.now);
const name = (p: { head: { title: string; storage: string; grade: string }; price: number; score: number }): string =>
  `${p.head.title} ${p.head.storage} [${p.head.grade}] £${p.price} (${p.score.toFixed(2)})`;

for (const want of ['iPhone 11|64GB', 'Galaxy A20e|32GB', 'iPhone 13|128GB', 'Galaxy A16 5G|128GB']) {
  const [title, storage] = want.split('|');
  const base = all.find((p) => p.head.title === title && p.head.storage === storage);
  if (!base) continue;
  console.log(`\nSTEP UP from ${name(base)}`);
  for (const s of stepUps(base, all, 60)) {
    console.log(`  ${s.kind.padEnd(5)} +£${s.product.price - base.price}  ${name(s.product)}`);
    for (const g of s.diff.gains) console.log(`        + ${g}`);
    for (const l of s.diff.losses) console.log(`        - ${l}`);
  }
}
for (const [budget, type] of [[150, 'iphone'], [100, 'android'], [200, 'phone'], [300, 'ipad']] as const) {
  const f = fit(all, budget, 60, { type, updates: true, storage: 0, tidy: false });
  console.log(`\nBUDGET £${budget} ${type}`);
  const rungs = [f.saver, f.pick, f.stretch];
  rungs.forEach((p, i) => {
    if (!p) return console.log(`  ${['saver', 'pick', 'stretch'][i]}: none`);
    console.log(`  ${['saver', 'pick', 'stretch'][i].padEnd(7)} ${name(p)}${i === 0 && f.saverCompromises ? '  (does not meet needs)' : ''}`);
    const prev = rungs.slice(0, i).reverse().find(Boolean);
    if (prev) for (const g of diff(prev.head, p.head).gains) console.log(`        + ${g}`);
  });
}
