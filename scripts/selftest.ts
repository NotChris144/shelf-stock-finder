// Prints how the sample listings are parsed and scored:  npm run selftest
import snapshot from '../src/data/eol-snapshot.json' with { type: 'json' };
import { DEMO_HITS } from '../src/demo.ts';
import type { EolDb } from '../src/eol.ts';
import { toItem } from '../src/parse.ts';
import { makeCtx } from '../src/support.ts';

const ctx = makeCtx(snapshot as unknown as EolDb);
const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
for (const [i, h] of DEMO_HITS.entries()) {
  const it = toItem(h, i, ctx);
  console.log(
    [
      pad(it.kind, 7),
      pad(it.title, 26),
      pad(it.sub, 44),
      pad(it.variant + (it.grade ? ` [${it.grade}]` : ''), 22),
      pad(`${it.support.status}: ${it.support.label}`, 32),
      it.perf ? `${it.perf.tier} ${it.perf.label} ${it.perf.score}` : '-',
    ].join(' | '),
  );
}
