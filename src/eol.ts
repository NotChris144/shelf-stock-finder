// Device lifecycle data from https://endoflife.date (free, no key, CORS-enabled).
// Used by both the app (weekly background refresh) and scripts/update-support.ts
// (which bakes a snapshot into src/data so the app works before the first refresh).

/** [normalised model key, release date, eol (date | true = ended | false = still supported), OS range] */
export type EolEntry = [k: string, r: string, e: string | boolean, os?: string];

export interface EolDb {
  /** ISO date the data was fetched. */
  at: string;
  latest: { ios: string; ipados: string; android: string; macos: string };
  brands: Record<string, EolEntry[]>;
}

const API = 'https://endoflife.date/api/';

/** Brand → endoflife.date product slug. */
export const BRAND_SOURCES: Record<string, string> = {
  apple: 'iphone',
  samsung: 'samsung-mobile',
  google: 'pixel',
  oneplus: 'oneplus',
  motorola: 'motorola-mobility',
  nokia: 'nokia',
  sony: 'sony-xperia',
  fairphone: 'fairphone',
};

const OS_SOURCES = { ios: 'ios', ipados: 'ipados', android: 'android', macos: 'macos' } as const;

/** Collapse a model name to a comparable key: "Galaxy S24+" and "Samsung Galaxy S24 Plus" both → "galaxys24plus". */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/generation/g, 'gen')
    .replace(/\b(samsung|apple|google|motorola|nokia|sony|oneplus|fairphone)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Drop network/SIM suffixes so "galaxys225g" can fall back to "galaxys22". */
export const stripNet = (k: string): string => k.replace(/(5g|4g|lte|dualsim)/g, '');

interface RawCycle {
  cycle: string;
  releaseLabel?: string;
  releaseDate?: string;
  eol?: string | boolean;
  supportedIosVersions?: string;
  supportedAndroidVersions?: string;
}

function slim(brand: string, raw: RawCycle[]): EolEntry[] {
  const out: EolEntry[] = [];
  for (const c of raw) {
    const label = c.releaseLabel && !c.releaseLabel.includes('__') ? c.releaseLabel : c.cycle;
    const os = c.supportedIosVersions ?? c.supportedAndroidVersions;
    const mk = (name: string): EolEntry => {
      const e: EolEntry = [norm(name), c.releaseDate ?? '', c.eol ?? false];
      if (os) e.push(String(os));
      return e;
    };
    if (brand === 'apple') {
      out.push(mk('iphone ' + label));
      // CeX calls these "iPhone Air" and plain "iPhone SE".
      if (/air/i.test(label)) out.push(mk('iphone air'));
      if (/^se \(1st/i.test(label)) out.push(mk('iphone se'));
    } else {
      out.push(mk(label));
    }
  }
  return out;
}

export async function fetchEolDb(signal?: AbortSignal): Promise<EolDb> {
  const get = async (slug: string): Promise<RawCycle[]> => {
    const r = await fetch(`${API}${slug}.json`, { signal });
    if (!r.ok) throw new Error(`endoflife.date ${slug}: ${r.status}`);
    return (await r.json()) as RawCycle[];
  };
  const brandNames = Object.keys(BRAND_SOURCES);
  const osNames = Object.keys(OS_SOURCES) as (keyof typeof OS_SOURCES)[];
  const [brandData, osData] = await Promise.all([
    Promise.all(brandNames.map((b) => get(BRAND_SOURCES[b]))),
    Promise.all(osNames.map((o) => get(OS_SOURCES[o]))),
  ]);
  const brands: Record<string, EolEntry[]> = {};
  brandNames.forEach((b, i) => (brands[b] = slim(b, brandData[i])));
  const latest = { ios: '', ipados: '', android: '', macos: '' };
  // Cycles are listed newest first.
  osNames.forEach((o, i) => (latest[o] = String(osData[i][0]?.cycle ?? '')));
  return { at: new Date().toISOString().slice(0, 10), latest, brands };
}

export type EolIndex = Map<string, Map<string, EolEntry>>;

export function buildIndex(db: EolDb): EolIndex {
  const idx: EolIndex = new Map();
  for (const [brand, entries] of Object.entries(db.brands)) {
    const m = new Map<string, EolEntry>();
    for (const e of entries) if (!m.has(e[0])) m.set(e[0], e);
    // Aliases without the network suffix, never overriding a real model.
    for (const e of entries) {
      const a = stripNet(e[0]);
      if (!m.has(a)) m.set(a, e);
    }
    idx.set(brand, m);
  }
  return idx;
}

/** Try progressively looser keys for each candidate model name. */
export function findEntry(idx: EolIndex, brand: string, models: string[]): EolEntry | undefined {
  const m = idx.get(brand);
  if (!m) return undefined;
  for (const raw of models) {
    if (!raw) continue;
    const k = norm(raw);
    const noYear = k.replace(/20[12]\d$/, '');
    for (const c of [k, stripNet(k), k + '5g', noYear, stripNet(noYear)]) {
      const e = c && m.get(c);
      if (e) return e;
    }
  }
  return undefined;
}
