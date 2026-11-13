// Search client for the index that powers uk.webuy.com's own search page.
//
// The store filter (`stores:<name>`) only matches items that branch has in stock, so every
// result is something physically on the shelf. Requests are a single POST with a text/plain
// body (no CORS preflight) and only the fields the UI needs, which keeps round trips small.

import type { Hit } from './types.ts';

export const CONFIG = {
  endpoint: 'https://search.webuy.io/1/indexes/*/queries',
  appId: 'LNNFEEWZVA',
  apiKey: 'bf79f2b6699e60a18ae330a1248b452c',
  index: 'prod_cex_uk',
};

const BASE_FILTER = 'boxVisibilityOnWeb=1 AND boxSaleAllowed=1 AND sellPrice > 0';
const ATTRS = [
  'boxId', 'boxName', 'sellPrice', 'cashPriceCalculated', 'exchangePriceCalculated', 'categoryFriendlyName',
  'superCatFriendlyName', 'imageUrls', 'Grade', 'rating', 'Manufacturer', 'Phone Model', 'Model Name', 'CPU Model',
  'Generation', 'priceLastChanged',
];

export interface Preset {
  id: string;
  label: string;
  /** OR-ed facet filters. */
  ff: string[];
  /** Extra query text sent with the preset. */
  q?: string;
  /** Client-side category check applied after fetching. */
  keep?: RegExp;
}

export const PRESETS: Preset[] = [
  { id: 'phones', label: 'Phones', ff: ['categoryFriendlyName:Android Phones', 'productLineName:iPhones'] },
  { id: 'tablets', label: 'Tablets', ff: ['categoryFriendlyName:Apple iPad', 'categoryFriendlyName:Tablets - Android', 'categoryFriendlyName:Tablets - Windows'] },
  { id: 'laptops', label: 'Laptops', ff: ['categoryFriendlyName:Laptops - Windows', 'categoryFriendlyName:Laptops - Apple Mac', 'categoryFriendlyName:Chromebooks'] },
  { id: 'desktops', label: 'Desktops', ff: ['categoryFriendlyName:Desktops - Windows', 'categoryFriendlyName:Desktops - Apple Mac'] },
  // CeX files every game under the "Gaming Software" product line and every console under
  // "Gaming Consoles"; the Gaming department as a whole also holds controllers and accessories.
  { id: 'consoles', label: 'Consoles', ff: ['productLineName:Gaming Consoles'] },
  { id: 'gaming', label: 'Games', ff: ['productLineName:Gaming Software'] },
  { id: 'electronics', label: 'Electronics', ff: ['superCatFriendlyName:Electronics'] },
  { id: 'film', label: 'Film & TV', ff: ['superCatFriendlyName:Film & TV'] },
];

export interface SearchResult {
  hits: Hit[];
  /** Total matches in the index (may exceed hits.length). */
  total: number;
  /** Round-trip time in ms. */
  ms: number;
}

const url = (): string =>
  `${CONFIG.endpoint}?x-algolia-application-id=${CONFIG.appId}&x-algolia-api-key=${CONFIG.apiKey}`;

async function post(requests: unknown[], signal?: AbortSignal): Promise<any[]> {
  const res = await fetch(url(), { method: 'POST', body: JSON.stringify({ requests }), signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  return (await res.json()).results;
}

const cache = new Map<string, { at: number; p: Promise<SearchResult> }>();
/** Results are reused for this long so flicking between filters is instant; after that the server is asked again. */
const TTL = 60_000;

export function clearCache(): void {
  cache.clear();
}

export interface SearchOptions {
  q: string;
  store: string;
  preset?: Preset;
  signal?: AbortSignal;
  /** Skip the short-lived cache. */
  fresh?: boolean;
  /** More required facets, each an "any of" list. Done on the server because a branch can hold more of a category than one request returns. */
  extra?: string[][];
  /** Highest price to return (0 = any). */
  max?: number;
  /** Server-side ordering; anything else is best match. */
  order?: string;
}

// CeX keeps a copy of its index for each ordering its website offers.
const ORDERED: Record<string, string> = { pop: '_popularity_desc', price: '_price_asc', priceDesc: '_price_desc', rated: '_rating_desc' };

export function search({ q, store, preset, signal, fresh = false, extra = [], max = 0, order = '' }: SearchOptions): Promise<SearchResult> {
  const index = CONFIG.index + (ORDERED[order] ?? '');
  const key = `${store}|${preset?.id ?? ''}|${extra.map((e) => e.join(',')).join('+')}|${max}|${index}|${q.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && !fresh && Date.now() - hit.at < TTL) return hit.p;
  const t0 = performance.now();
  const facetFilters: string[][] = [[`stores:${store}`]];
  if (preset) facetFilters.push(preset.ff);
  for (const anyOf of extra) facetFilters.push(anyOf);
  const p = post(
    [
      {
        indexName: index,
        query: [preset?.q, q.trim()].filter(Boolean).join(' '),
        // Presets want the whole shelf for client-side filtering; free text wants speed.
        hitsPerPage: preset ? 1000 : 300,
        page: 0,
        facetFilters,
        filters: max ? `${BASE_FILTER} AND sellPrice <= ${max}` : BASE_FILTER,
        attributesToRetrieve: ATTRS,
        attributesToHighlight: [],
        analytics: false,
        clickAnalytics: false,
      },
    ],
    signal,
  ).then((r) => {
    let hits = (r[0].hits ?? []) as Hit[];
    if (preset?.keep) hits = hits.filter((h) => preset.keep!.test(String(h.categoryFriendlyName ?? '')));
    return { hits, total: preset?.keep ? hits.length : Number(r[0].nbHits ?? hits.length), ms: Math.round(performance.now() - t0) };
  });
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key));
  return p;
}

/**
 * Look products up by the ID printed (and barcoded) on their shelf labels. Not limited to one
 * store, because a label in your hand proves the item exists; `here` says which of them the
 * website also lists as in stock at `store`.
 */
export async function lookupIds(ids: string[], store: string): Promise<{ hits: Hit[]; here: Set<string> }> {
  const filters = ids.map((id) => `objectID:"${id.replace(/[^\w.-]/g, '')}"`).join(' OR ');
  const base = { indexName: CONFIG.index, query: '', hitsPerPage: ids.length, filters, attributesToHighlight: [], analytics: false, clickAnalytics: false };
  const r = await post([
    { ...base, attributesToRetrieve: ATTRS },
    { ...base, attributesToRetrieve: ['boxId'], facetFilters: [[`stores:${store}`]] },
  ]);
  return {
    hits: (r[0].hits ?? []) as Hit[],
    here: new Set(((r[1].hits ?? []) as Hit[]).map((h) => String(h.boxId))),
  };
}

/** Every branch name, for the store picker. */
export async function fetchStores(): Promise<string[]> {
  const r = await post([
    { indexName: CONFIG.index, query: '', hitsPerPage: 0, facets: ['stores'], maxValuesPerFacet: 1000, analytics: false },
  ]);
  return Object.keys(r[0].facets?.stores ?? {}).sort((a, b) => a.localeCompare(b));
}
