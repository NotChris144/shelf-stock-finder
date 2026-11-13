// One look at the branch's stock, compared with the last:  node scripts/track-stock.ts <folder>
//
// Reads state.json and log.json from the folder (absent on the first run), lists everything the
// branch has in stock now, records what has come in and what has gone (src/tracker.ts), and
// writes both files back. Run every 15 minutes by .github/workflows/stock.yml, which keeps the
// folder on the repository's `stock-data` branch.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Busy, compare, fetchStock, queries, record, type Log, type State } from '../src/tracker.ts';

const STORE = 'Eastbourne';
const dir = process.argv[2] ?? 'stock-data';
mkdirSync(dir, { recursive: true });
const read = <T>(name: string): T | null => (existsSync(`${dir}/${name}`) ? (JSON.parse(readFileSync(`${dir}/${name}`, 'utf8')) as T) : null);

const now = Date.now();
const prev = read<State>('state.json');
const log = read<Log>('log.json');
let listing: Awaited<ReturnType<typeof fetchStock>>;
try {
  listing = await fetchStock(STORE);
} catch (e) {
  // Told to slow down: this look is skipped and the next one compares with the last good list,
  // so nothing is lost but precision. Not an error, or every busy spell would send an email.
  if (!(e instanceof Busy)) throw e;
  console.log(`Nothing recorded: ${e.message}. The next look carries on from the last good one.`);
  process.exit(0);
}
const { total, recs } = listing;
console.log(`Listed ${recs.length} of ${total} products in ${queries} queries.`);
const out = compare(prev, recs, total, now, STORE);
if (out.skipped) {
  console.log(`Nothing recorded: ${out.skipped}.`);
  process.exit(0);
}
const next = record(log, out, STORE, now);
writeFileSync(`${dir}/state.json`, JSON.stringify(out.state));
writeFileSync(`${dir}/log.json`, JSON.stringify(next));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'changed=1\n');

const tech = out.arrivals.filter((e) => e.r.t).length;
console.log(
  prev
    ? `${recs.length} products in stock at ${STORE}: ${out.arrivals.length} in (${tech} tech), ${out.sold.length} tech sold, ${Object.keys(out.state.missing).length} waiting to be confirmed gone.`
    : `First look: ${recs.length} products in stock at ${STORE}. Changes are recorded from the next look.`,
);
for (const e of out.arrivals.slice(0, 10)) console.log(`  in    £${e.r.p}  ${e.r.n}`);
for (const e of out.sold.slice(0, 10)) console.log(`  sold  £${e.r.p}  ${e.r.n}`);
