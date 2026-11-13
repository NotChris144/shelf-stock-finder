// Every product in a branch's live stock through the add-on rules and the guard:
//   npm run addonaudit [store]        (default Eastbourne; add --json for the full report)
//
// See src/addonAudit.ts for what it reports. It reads CeX's search once (a handful of requests in
// one round trip) and changes nothing.
import snapshot from '../src/data/eol-snapshot.json' with { type: 'json' };
import sheets from '../src/data/specs.json' with { type: 'json' };
import { audit, auditText } from '../src/addonAudit.ts';
import { branchStock } from '../src/api.ts';
import type { EolDb } from '../src/eol.ts';
import { toItem } from '../src/parse.ts';
import { useSheets, type SheetFile } from '../src/specs.ts';
import { makeCtx } from '../src/support.ts';

useSheets(sheets as unknown as SheetFile);
const ctx = makeCtx(snapshot as unknown as EolDb);
const store = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'Eastbourne';
const items = (await branchStock(store)).map((h, i) => toItem(h, i, ctx));
const report = audit(items);
console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : auditText(report, store));
