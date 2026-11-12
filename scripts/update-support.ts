// Refreshes the bundled lifecycle snapshot:  npm run update-support
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchEolDb } from '../src/eol.ts';

const db = await fetchEolDb();
const out = fileURLToPath(new URL('../src/data/eol-snapshot.json', import.meta.url));
writeFileSync(out, JSON.stringify(db));
const count = Object.values(db.brands).reduce((n, e) => n + e.length, 0);
console.log(`Saved ${count} models (${Object.keys(db.brands).join(', ')}) as of ${db.at}`);
console.log('Latest OS versions:', db.latest);
