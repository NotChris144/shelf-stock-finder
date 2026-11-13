import './styles.css';
import snapshot from './data/eol-snapshot.json';
import { PRESETS, clearCache, fetchStores, lookupIds, search } from './api.ts';
import { DEMO_HITS } from './demo.ts';
import { fetchEolDb, type EolDb } from './eol.ts';
import { clearStock, homeHtml, renderFlow, resetPickQuery, setPickQuery, type FlowHost } from './flows.ts';
import { getsUpdates, type FitType } from './sell.ts';
import { toItem } from './parse.ts';
import type { ScanHost, Scanner } from './scan.ts';
import { makeCtx } from './support.ts';
import type { Group, Hit, Item } from './types.ts';

// ------------------------------------------------------------------ helpers

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]);
const money = (n: number): string => '£' + (Number.isInteger(n) ? n : n.toFixed(2));
const YEAR = 365.25 * 864e5;

const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem('shelf.' + key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem('shelf.' + key, JSON.stringify(value));
    } catch {
      /* private mode or quota: the app works without persistence */
    }
  },
};

// ------------------------------------------------------------------ state

type Sort = 'rel' | 'price' | 'priceDesc' | 'perf' | 'value' | 'life';

interface Filters {
  q: string;
  preset: string;
  max: number;
  /** 0 any · 1 still getting updates · 2 at least two years left */
  up: number;
  /** Minimum speed tier (0 = any). */
  perf: number;
  sort: Sort;
  brands: string[];
  grades: string[];
  /** Category-specific filters, as option ids (see FACETS). */
  fx: string[];
  /** Sales flow: '' (search), 'up' (step up from a pick) or 'fit' (match a budget). */
  mode: '' | 'up' | 'fit';
  pick: string;
  bud: number;
  ft: FitType;
  need: string;
}

const DEFAULTS: Filters = { q: '', preset: '', max: 0, up: 0, perf: 0, sort: 'rel', brands: [], grades: [], fx: [], mode: '', pick: '', bud: 0, ft: 'phone', need: 'u' };
const FIT_TYPES: FitType[] = ['phone', 'iphone', 'android', 'ipad', 'androidtab'];
const SORTS: [Sort, string][] = [
  ['rel', 'Best match'],
  ['price', 'Price: low to high'],
  ['priceDesc', 'Price: high to low'],
  ['perf', 'Fastest first'],
  ['value', 'Best value (speed per £)'],
  ['life', 'Longest update support'],
];
const BUDGETS = [50, 100, 150, 200, 300, 500];
const PAGE = 30;

const demo = new URLSearchParams(location.search).has('demo');
const F: Filters = { ...DEFAULTS };
let branch = store.get('store', 'Eastbourne');
let grouped = store.get('group', true);
let db: EolDb = snapshot as unknown as EolDb;
const saved = store.get<EolDb | null>('eol', null);
if (saved && saved.at > db.at) db = saved;
let ctx = makeCtx(db);

let hits: Hit[] = [];
let items: Item[] = [];
let total = 0;
let ms = 0;
let loading = false;
let error = '';
let seq = 0;
let aborter: AbortController | null = null;
let shown = PAGE;
/** When stock was last fetched, so a phone coming back out of a pocket shows current stock. */
let loadedAt = Date.now();

let groups: Group[] = [];
let hiddenUnknown = 0;
let matched = 0;

// ------------------------------------------------------------------ category filters

/** What the current results mostly are, which decides the filters worth offering. */
type Shelf = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'console' | '';

interface Facet {
  id: string;
  label: string;
  test(it: Item): boolean;
}
interface FacetGroup {
  name: string;
  /** Options also shown in the quick row above results. */
  quick?: string[];
  options: Facet[];
}

const atLeast = (key: 'storageGb' | 'ramGb', id: string, n: number, label: string): Facet => ({ id, label, test: (it) => it[key] >= n });
const system = (id: string, label: string, os: string): Facet => ({ id, label, test: (it) => it.os === os });
const made = (id: string, label: string, re: RegExp): Facet => ({ id, label, test: (it) => re.test(it.category) });
const STORAGE_MOBILE: FacetGroup = {
  name: 'Storage',
  quick: ['st128'],
  options: [atLeast('storageGb', 'st64', 64, '64GB+'), atLeast('storageGb', 'st128', 128, '128GB+'), atLeast('storageGb', 'st256', 256, '256GB+')],
};
const MEMORY: FacetGroup = { name: 'Memory', quick: ['ram8', 'ram16'], options: [atLeast('ramGb', 'ram8', 8, '8GB RAM+'), atLeast('ramGb', 'ram16', 16, '16GB RAM+')] };
const STORAGE_PC: FacetGroup = {
  name: 'Storage',
  quick: ['ss256'],
  options: [atLeast('storageGb', 'ss256', 256, '256GB+'), atLeast('storageGb', 'ss512', 512, '512GB+'), atLeast('storageGb', 'ss1000', 1000, '1TB+')],
};
const GRAPHICS: FacetGroup = { name: 'Graphics', quick: ['gpu'], options: [{ id: 'gpu', label: 'Graphics card', test: (it) => it.gpu }] };

const FACETS: Record<Exclude<Shelf, ''>, FacetGroup[]> = {
  phone: [
    { name: 'System', quick: ['ios', 'and'], options: [system('ios', 'iPhone', 'iOS'), system('and', 'Android', 'Android')] },
    STORAGE_MOBILE,
    { name: 'Battery', quick: ['bat'], options: [{ id: 'bat', label: 'Big battery', test: (it) => (it.specs?.mah ?? 0) >= 4500 }] },
    {
      name: 'Camera',
      options: [
        { id: 'uw', label: 'Ultra-wide camera', test: (it) => Boolean(it.specs?.ultrawide) },
        { id: 'zoom', label: 'Zoom camera', test: (it) => Boolean(it.specs?.zoom) },
      ],
    },
  ],
  tablet: [
    { name: 'System', quick: ['ipad', 'andt'], options: [system('ipad', 'iPad', 'iPadOS'), system('andt', 'Android', 'Android'), system('wint', 'Windows', 'Windows')] },
    STORAGE_MOBILE,
    {
      name: 'Screen',
      quick: ['scl'],
      options: [
        { id: 'scs', label: 'Under 9″', test: (it) => it.screen > 0 && it.screen < 9 },
        { id: 'scm', label: '9″ to 12″', test: (it) => it.screen >= 9 && it.screen < 12 },
        { id: 'scl', label: '12″ and up', test: (it) => it.screen >= 12 },
      ],
    },
    {
      name: 'Connection',
      options: [
        { id: 'wifi', label: 'Wi-Fi only', test: (it) => !it.cellular },
        { id: 'sim', label: 'Takes a SIM', test: (it) => it.cellular },
      ],
    },
  ],
  laptop: [
    { name: 'System', quick: ['win', 'mac'], options: [system('win', 'Windows', 'Windows'), system('mac', 'Mac', 'macOS'), system('cros', 'Chromebook', 'ChromeOS')] },
    MEMORY,
    STORAGE_PC,
    {
      name: 'Screen',
      options: [
        { id: 'lsm', label: 'Up to 14″', test: (it) => it.screen > 0 && it.screen <= 14 },
        { id: 'llg', label: '15″ and up', test: (it) => it.screen >= 15 },
      ],
    },
    GRAPHICS,
  ],
  desktop: [
    { name: 'System', quick: ['win', 'mac'], options: [system('win', 'Windows', 'Windows'), system('mac', 'Mac', 'macOS')] },
    MEMORY,
    STORAGE_PC,
    GRAPHICS,
    { name: 'Type', options: [{ id: 'aio', label: 'All-in-one (has a screen)', test: (it) => it.screen > 0 }] },
  ],
  console: [
    {
      name: 'Make',
      quick: ['ps', 'xbox', 'nin'],
      options: [
        made('ps', 'PlayStation', /playstation|^ps/i),
        made('xbox', 'Xbox', /xbox/i),
        made('nin', 'Nintendo', /switch|wii|3ds|nintendo|game ?boy|gamecube|nes/i),
      ],
    },
    {
      name: 'Packaging',
      quick: ['boxed'],
      options: [
        { id: 'boxed', label: 'Boxed', test: (it) => it.condition === 'Boxed' },
        { id: 'unboxed', label: 'Unboxed', test: (it) => it.condition === 'Unboxed' },
        { id: 'disc', label: 'Discounted', test: (it) => it.condition === 'Discounted' },
      ],
    },
  ],
};

const shelfOf = (it: Item): Shelf => (it.kind !== 'other' ? it.kind : /consoles?$/i.test(it.category) ? 'console' : '');

/** A category chip decides it outright; a free-text search adapts when most results are one kind. */
function shelf(): Shelf {
  const byPreset: Record<string, Shelf> = { phones: 'phone', tablets: 'tablet', laptops: 'laptop', desktops: 'desktop', consoles: 'console' };
  if (F.preset) return byPreset[F.preset] ?? '';
  if (!items.length) return '';
  const counts = new Map<Shelf, number>();
  for (const it of items) counts.set(shelfOf(it), (counts.get(shelfOf(it)) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n >= items.length * 0.6 ? top : '';
}

const isDevice = (s: Shelf): boolean => s === 'phone' || s === 'tablet' || s === 'laptop' || s === 'desktop';
const facetGroups = (): FacetGroup[] => {
  const s = shelf();
  return s ? FACETS[s] : [];
};

// ------------------------------------------------------------------ URL state

function readHash(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  Object.assign(F, DEFAULTS, {
    q: p.get('q') ?? '',
    preset: PRESETS.some((x) => x.id === p.get('p')) ? p.get('p')! : '',
    max: Number(p.get('max')) || 0,
    up: Math.min(2, Number(p.get('up')) || 0),
    perf: Math.min(5, Number(p.get('perf')) || 0),
    sort: SORTS.some(([s]) => s === p.get('sort')) ? (p.get('sort') as Sort) : 'rel',
    brands: p.get('b')?.split('~').filter(Boolean) ?? [],
    grades: p.get('g')?.split('~').filter(Boolean) ?? [],
    fx: p.get('x')?.split('~').filter(Boolean) ?? [],
    mode: p.get('m') === 'up' || p.get('m') === 'fit' ? p.get('m') : '',
    pick: p.get('id') ?? '',
    bud: Number(p.get('bud')) || 0,
    ft: FIT_TYPES.includes(p.get('ft') as FitType) ? p.get('ft') : 'phone',
    need: p.has('need') ? (p.get('need') ?? '') : 'u',
  });
}

function writeHash(): void {
  const p = new URLSearchParams();
  if (F.q) p.set('q', F.q);
  if (F.preset) p.set('p', F.preset);
  if (F.max) p.set('max', String(F.max));
  if (F.up) p.set('up', String(F.up));
  if (F.perf) p.set('perf', String(F.perf));
  if (F.sort !== 'rel') p.set('sort', F.sort);
  if (F.brands.length) p.set('b', F.brands.join('~'));
  if (F.grades.length) p.set('g', F.grades.join('~'));
  if (F.fx.length) p.set('x', F.fx.join('~'));
  if (F.mode) {
    p.set('m', F.mode);
    if (F.pick) p.set('id', F.pick);
    if (F.bud) p.set('bud', String(F.bud));
    if (F.ft !== 'phone') p.set('ft', F.ft);
    if (F.need !== 'u') p.set('need', F.need);
  }
  const h = p.toString();
  history.replaceState(null, '', location.pathname + location.search + (h ? '#' + h : ''));
}

// ------------------------------------------------------------------ data

function demoSearch(): Hit[] {
  const kinds: Record<string, RegExp> = {
    phones: /iphone|android phones/i,
    tablets: /ipad|^tablets -/i,
    laptops: /^laptops|chromebook/i,
    desktops: /^desktops/i,
  };
  const words = F.q.toLowerCase().split(/\s+/).filter(Boolean);
  return DEMO_HITS.filter((h) => {
    if (F.preset && !(kinds[F.preset]?.test(h.categoryFriendlyName ?? '') ?? false)) return false;
    if (/accessor/i.test(h.categoryFriendlyName ?? '') && F.preset) return false;
    return words.every((w) => h.boxName.toLowerCase().includes(w));
  });
}

async function load(fresh = false): Promise<void> {
  aborter?.abort();
  const mine = ++seq;
  error = '';
  if (F.mode || (!F.q.trim() && !F.preset)) {
    hits = [];
    items = [];
    total = 0;
    loading = false;
    render();
    return;
  }
  loading = true;
  renderStatus();
  try {
    if (demo) {
      hits = demoSearch();
      total = hits.length;
      ms = 0;
    } else {
      aborter = new AbortController();
      const r = await search(F.q, branch, PRESETS.find((p) => p.id === F.preset), aborter.signal, fresh);
      if (mine !== seq) return;
      hits = r.hits;
      total = r.total;
      ms = r.ms;
    }
    items = hits.map((h, i) => toItem(h, i, ctx));
  } catch (e) {
    if (mine !== seq || (e instanceof DOMException && e.name === 'AbortError')) return;
    hits = [];
    items = [];
    error = e instanceof TypeError ? 'offline' : e instanceof Error ? e.message : 'Search failed';
  }
  loading = false;
  loadedAt = Date.now();
  shown = PAGE;
  render();
}

function compute(): void {
  const now = Date.now();
  hiddenUnknown = 0;
  const kept: Item[] = [];
  const active = facetGroups().flatMap((g) => g.options).filter((o) => F.fx.includes(o.id));
  for (const it of items) {
    if (F.max && it.price > F.max) continue;
    if (active.some((o) => !o.test(it))) continue;
    if (F.up) {
      const s = it.support;
      if (s.status === 'unknown') {
        hiddenUnknown++;
        continue;
      }
      if (!getsUpdates(s)) continue;
      if (F.up === 2 && (s.status !== 'ok' || (s.until !== undefined && s.until - now < 2 * YEAR))) continue;
    }
    if (F.perf && (!it.perf || it.perf.tier < F.perf)) continue;
    if (F.brands.length && !F.brands.includes(it.brand)) continue;
    if (F.grades.length && !F.grades.includes(it.grade)) continue;
    kept.push(it);
  }
  matched = kept.length;
  const map = new Map<string, Group>();
  for (const it of kept) {
    const key = grouped ? it.gkey : it.id;
    const g = map.get(key);
    if (!g) map.set(key, { key, items: [it], head: it, min: it.price, max: it.price });
    else {
      g.items.push(it);
      if (it.price < g.min) {
        g.min = it.price;
        g.head = it;
      }
      if (it.price > g.max) g.max = it.price;
    }
  }
  groups = [...map.values()];
  for (const g of groups) g.items.sort((a, b) => a.price - b.price || a.variant.localeCompare(b.variant));

  const life = (g: Group): number => {
    const s = g.head.support;
    if (s.status === 'ended') return -1;
    if (s.status === 'unknown' || s.status === 'na') return -2;
    return s.until ?? (s.status === 'ok' ? now + 3 * YEAR : now);
  };
  const pct = (g: Group): number => g.head.perf?.pct ?? -1;
  const value = (g: Group): number => (g.head.perf ? g.head.perf.pct / Math.max(1, g.min) : -1);
  const rel = (a: Group, b: Group): number => a.head.idx - b.head.idx;
  const by: Record<Sort, (a: Group, b: Group) => number> = {
    rel,
    price: (a, b) => a.min - b.min || rel(a, b),
    priceDesc: (a, b) => b.min - a.min || rel(a, b),
    perf: (a, b) => pct(b) - pct(a) || a.min - b.min,
    value: (a, b) => value(b) - value(a) || a.min - b.min,
    life: (a, b) => life(b) - life(a) || a.min - b.min,
  };
  groups.sort(by[F.sort]);
}

// ------------------------------------------------------------------ rendering

const ICON_PHONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>';
const ICON_LAPTOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5" width="15" height="10" rx="1.5"/><path d="M2.5 18.5h19"/></svg>';
const ICON_BOX = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/></svg>';

function chip(act: string, value: string | number, label: string, on: boolean, extra = ''): string {
  return `<button type="button" class="chip${extra}" data-act="${act}" data-v="${esc(String(value))}" aria-pressed="${on}">${label}</button>`;
}

function bars(tier: number): string {
  return `<span class="bars" aria-hidden="true">${[1, 2, 3, 4, 5].map((i) => `<i${i <= tier ? ' class="on"' : ''}></i>`).join('')}</span>`;
}

function filterControls(inSheet: boolean): string {
  const budget = BUDGETS.map((b) => chip('max', b, `£${b}`, F.max === b)).join('');
  const custom = F.max && !BUDGETS.includes(F.max) ? chip('max', F.max, `£${F.max}`, true) : '';
  const speed = [
    [3, 'Good+'],
    [4, 'Fast+'],
    [5, 'Top'],
  ]
    .map(([t, l]) => chip('perf', t, `${bars(t as number)}${l}`, F.perf === t))
    .join('');
  const sorts = isDevice(shelf()) ? SORTS : SORTS.filter(([v]) => v === 'rel' || v === 'price' || v === 'priceDesc');
  const sort = `<label class="select"><span class="sr">Sort by</span><select data-act="sort">${sorts.map(
    ([v, l]) => `<option value="${v}"${F.sort === v ? ' selected' : ''}>${l}</option>`,
  ).join('')}</select></label>`;
  const updates = chip('up', 1, 'Still gets updates', F.up === 1) + chip('up', 2, '2+ years left', F.up === 2);
  const device = isDevice(shelf());
  const groups = facetGroups();
  const fx = (o: Facet): string => chip('fx', o.id, o.label, F.fx.includes(o.id));
  if (!inSheet) {
    // Two swipeable rows keep results high on a phone screen; the sheet has the labelled version.
    const quick = groups.map((g) => g.options.filter((o) => g.quick?.includes(o.id)).map(fx).join('')).filter(Boolean);
    const first = [device ? updates : '', device ? speed : '', ...quick].filter(Boolean).join('<span class="sep"></span>');
    return `
      ${first ? `<div class="frow">${first}</div>` : ''}
      <div class="frow"><span class="flabel">Under</span>${budget}${custom}<span class="sep"></span>${sort}<button type="button" class="chip ghost" data-act="more">More</button></div>`;
  }
  return `
    <div class="frow wrap"><span class="flabel">Budget — under</span>${budget}${custom}</div>
    ${device ? `<div class="frow wrap"><span class="flabel">Updates</span>${updates}</div>
    <div class="frow wrap"><span class="flabel">Speed</span>${speed}</div>` : ''}
    ${groups.map((g) => `<div class="frow wrap"><span class="flabel">${g.name}</span>${g.options.map(fx).join('')}</div>`).join('')}
    <div class="frow wrap"><span class="flabel">Sort</span>${sort}</div>`;
}

function activeCount(): number {
  return (F.max ? 1 : 0) + (F.up ? 1 : 0) + (F.perf ? 1 : 0) + (F.sort !== 'rel' ? 1 : 0) + F.brands.length + F.grades.length + F.fx.length;
}

function renderChrome(): void {
  $('#storeName').textContent = branch;
  const q = $<HTMLInputElement>('#q');
  // While the box has focus it is the source of truth (a slow response must not overwrite typing).
  if (document.activeElement !== q) q.value = F.q;
  q.placeholder = `Search ${branch} stock…`;
  $('#clear').hidden = !F.q;
  $('#presets').innerHTML = PRESETS.map((p) => chip('preset', p.id, p.label, F.preset === p.id)).join('');
  $('#filters').innerHTML = filterControls(false);
  const n = activeCount();
  const fab = $('#fab');
  fab.textContent = n ? `Filters · ${n}` : 'Filters';
  fab.classList.toggle('has', n > 0);
}

function renderStatus(): void {
  const el = $('#status');
  if (loading) el.textContent = 'Searching…';
  else if (error) el.textContent = 'Offline';
  else if (F.mode || isHome()) el.textContent = demo ? 'Demo data' : 'In-stock only';
  else el.textContent = `${total.toLocaleString('en-GB')} in stock${demo ? ' · demo' : ms ? ` · ${ms} ms` : ''}`;
  document.body.classList.toggle('loading', loading);
}

function supportBadge(it: Item): string {
  const s = it.support;
  if (s.status === 'na') return '';
  return `<span class="badge st-${s.status}"><i></i>${esc(s.label)}</span>`;
}

function perfBadge(it: Item): string {
  return it.perf ? `<span class="badge speed">${bars(it.perf.tier)}${it.perf.label}</span>` : '';
}

function cardHtml(g: Group, note = '', opts: { cls?: string; tag?: string; vt?: string } = {}): string {
  const it = g.head;
  const n = g.items.length;
  const grades = [...new Set(g.items.map((i) => i.grade).filter(Boolean))].sort();
  const gradeTxt = grades.length ? `Grade ${grades.join(', ')}` : '';
  const meta = n > 1 ? [`${n} in stock`, gradeTxt].filter(Boolean).join(' · ') : [it.variant, gradeTxt].filter(Boolean).join(' · ');
  const icon = it.kind === 'phone' || it.kind === 'tablet' ? ICON_PHONE : it.kind === 'other' ? ICON_BOX : ICON_LAPTOP;
  const img = it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" decoding="async" width="64" height="64" onerror="this.remove()">` : '';
  const price = g.max > g.min ? `<small>from</small>${money(g.min)}` : money(g.min);
  const tag = opts.tag ? `<span class="badge tag">${esc(opts.tag)}</span>` : '';
  return `<li class="card${opts.cls ?? ''}" data-key="${esc(g.key)}"${opts.vt ? ` style="view-transition-name:${opts.vt}"` : ''}>
    <button type="button" class="card-main" data-act="toggle" aria-expanded="false">
      <span class="thumb">${icon}${img}</span>
      <span class="body">
        <span class="title">${esc(it.title)}</span>
        <span class="sub">${esc(it.sub)}</span>
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
        ${note ? `<span class="meta">${esc(note)}</span>` : ''}
        <span class="badges">${tag}${supportBadge(it)}${perfBadge(it)}</span>
      </span>
      <span class="price">${price}</span>
    </button>
  </li>`;
}

function detailHtml(g: Group): string {
  const it = g.head;
  const s = it.support;
  const why = s.status === 'na' ? '' : `<p class="why st-${s.status}"><b>Updates</b>${esc(s.detail)}</p>`;
  const speed = it.perf
    ? `<p class="why"><b>Speed</b>${it.perf.label} — about ${it.perf.score.toLocaleString('en-GB')} points${it.perf.chip ? ` (${esc(it.perf.chip)})` : ''}. Approximate benchmark, for comparing stock.</p>`
    : '';
  const rows = g.items
    .map((v) => {
      const href = demo ? `https://uk.webuy.com/search?stext=${encodeURIComponent(v.name)}` : `https://uk.webuy.com/product-detail?id=${encodeURIComponent(v.id)}`;
      const buy = v.cash || v.voucher ? `<span class="buy">We pay ${money(v.cash)} cash · ${money(v.voucher)} voucher</span>` : '';
      return `<li><a href="${href}" target="_blank" rel="noopener">
        <span class="v-name">${esc(v.variant || v.name)}${buy}</span>
        ${v.grade ? `<span class="grade g${v.grade}">${v.grade}</span>` : ''}
        <span class="v-price">${money(v.price)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </a></li>`;
    })
    .join('');
  const scanned = g.key.startsWith('scan:');
  let priced = '';
  if (it.priceChanged) {
    const days = Math.floor((Date.now() - it.priceChanged) / 864e5);
    const when = new Date(it.priceChanged).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    priced = `<p class="why${days <= 7 ? ' st-warn' : ''}"><b>Price</b>${money(it.price)} on the system, last changed ${when} (${ago}).${scanned ? ' If the label shows a different price, it needs reprinting.' : ''}</p>`;
  }
  const sellable = it.kind === 'phone' || it.kind === 'tablet';
  const similar =
    scanned && (it.model || it.title)
      ? `<div class="detail-acts">${sellable ? `<button type="button" class="chip" aria-pressed="true" data-act="stepup" data-v="${esc(it.id)}">Find a step up</button>` : ''}<button type="button" class="chip" data-act="similar" data-v="${esc(it.model || it.title)}">Find similar in stock</button></div>`
      : '';
  return `<div class="detail">${priced}${why}${speed}<ul class="variants">${rows}</ul>${similar}</div>`;
}

const isHome = (): boolean => !F.mode && !F.q.trim() && !F.preset;

function renderResults(): void {
  const main = $('#results');
  const home = isHome();
  const plain = home || Boolean(F.mode);
  $('#filters').hidden = plain;
  // On the home screen the categories sit under the two sales options instead.
  $('#presets').hidden = plain;
  $('#fab').hidden = plain || !filtersOffscreen;
  if (F.mode) {
    renderFlow(flowHost, F, main);
    return;
  }
  delete main.dataset.shell;
  if (home) {
    main.innerHTML = homeHtml(flowHost);
    return;
  }
  if (error) {
    const msg =
      error === 'offline'
        ? "Couldn't reach the CeX search service. Check your connection, then try again."
        : esc(error);
    main.innerHTML = `<div class="empty"><p>${msg}</p><button type="button" class="chip" data-act="retry" aria-pressed="true">Try again</button></div>`;
    return;
  }
  if (loading && !items.length) {
    main.innerHTML = `<ul class="list">${'<li class="card skeleton"></li>'.repeat(6)}</ul>`;
    return;
  }
  compute();
  if (!groups.length) {
    const filtered = items.length > 0;
    main.innerHTML = `<div class="empty"><p>${
      filtered
        ? `Nothing in stock matches these filters. ${items.length} item${items.length === 1 ? '' : 's'} match without them.`
        : `Nothing in stock at ${esc(branch)} for “${esc(F.q || PRESETS.find((p) => p.id === F.preset)?.label || '')}”.`
    }</p>${filtered ? '<button type="button" class="chip" data-act="reset" aria-pressed="true">Clear filters</button>' : ''}</div>`;
    return;
  }
  const parts = [
    grouped && groups.length !== matched ? `${groups.length} models · ${matched} items` : `${matched} item${matched === 1 ? '' : 's'}`,
  ];
  if (hiddenUnknown) parts.push(`${hiddenUnknown} hidden (update status unknown)`);
  if (total > hits.length) parts.push(`first ${hits.length} of ${total.toLocaleString('en-GB')} — search to narrow`);
  main.innerHTML = `<p class="summary">${parts.join(' · ')}${activeCount() ? ' <button type="button" class="link" data-act="reset">Clear filters</button>' : ''}</p>
    <ul class="list" id="list">${groups.slice(0, shown).map((g) => cardHtml(g)).join('')}</ul>
    <div id="sentinel"></div>`;
  pager.observe($('#sentinel'));
}

function render(): void {
  renderChrome();
  renderStatus();
  renderResults();
}

const pager = new IntersectionObserver(
  (entries) => {
    if (!entries.some((e) => e.isIntersecting) || shown >= groups.length) return;
    const next = groups.slice(shown, shown + PAGE);
    shown += PAGE;
    document.getElementById('list')?.insertAdjacentHTML('beforeend', next.map((g) => cardHtml(g)).join(''));
  },
  { rootMargin: '600px' },
);

let filtersOffscreen = false;
new IntersectionObserver(([e]) => {
  filtersOffscreen = !e.isIntersecting;
  $('#fab').hidden = !filtersOffscreen || isHome() || Boolean(F.mode);
}).observe($('#filters'));

// ------------------------------------------------------------------ sheet

async function openSheet(): Promise<void> {
  const sheet = $<HTMLDialogElement>('#sheet');
  const draw = (stores: string[] = []): void => {
    const counts = new Map<string, number>();
    for (const it of items) if (it.brand) counts.set(it.brand, (counts.get(it.brand) ?? 0) + 1);
    const brands = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
    const grades = ['A', 'B', 'C'].filter((g) => items.some((i) => i.grade === g));
    sheet.innerHTML = `<form method="dialog" class="sheet-in">
      <header><h2>Filters and settings</h2><button class="chip" aria-pressed="true" value="close">Done</button></header>
      ${filterControls(true)}
      <div class="frow wrap"><span class="flabel">Max £</span><input class="num" type="number" inputmode="numeric" min="0" step="5" placeholder="Any" value="${F.max || ''}" data-act="maxInput" aria-label="Maximum price in pounds"></div>
      ${brands.length > 1 ? `<div class="frow wrap"><span class="flabel">Brand</span>${brands.map(([b, n]) => chip('brand', b, `${esc(b)} <em>${n}</em>`, F.brands.includes(b))).join('')}</div>` : ''}
      ${grades.length > 1 ? `<div class="frow wrap"><span class="flabel">Grade</span>${grades.map((g) => chip('grade', g, g, F.grades.includes(g))).join('')}</div>` : ''}
      <div class="frow wrap"><span class="flabel">Step-up limit — how far over their price to suggest</span>${[30, 60, 100, 150].map((l) => chip('limit', l, `£${l}`, stepLimit === l)).join('')}<input class="num" type="number" inputmode="numeric" min="5" step="5" placeholder="Other £" value="${[30, 60, 100, 150].includes(stepLimit) ? '' : stepLimit}" data-act="limitInput" aria-label="Step-up limit in pounds"></div>
      <div class="frow wrap"><span class="flabel">View</span>${chip('group', 1, 'Group colours & grades', grouped)}</div>
      <div class="frow wrap"><span class="flabel">Store</span><input class="text" list="stores" value="${esc(branch)}" data-act="store" aria-label="Store" autocomplete="off"><datalist id="stores">${stores.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <p class="fine">Update dates come from endoflife.date (refreshed ${esc(db.at)}); Apple dates are estimates. Speed ratings are approximate chip benchmarks.</p>
      ${activeCount() ? '<button type="button" class="link" data-act="reset">Clear all filters</button>' : ''}
    </form>`;
  };
  draw(storeList);
  if (!sheet.open) sheet.showModal();
  if (!storeList.length && !demo) {
    try {
      storeList = await fetchStores();
      const input = sheet.querySelector<HTMLDataListElement>('#stores');
      if (input) input.innerHTML = storeList.map((s) => `<option value="${esc(s)}">`).join('');
    } catch {
      /* the store box still accepts a typed name */
    }
  }
}
let storeList: string[] = [];
const sheetOpen = (): boolean => $<HTMLDialogElement>('#sheet').open;

// ------------------------------------------------------------------ sales flows

/** How many pounds above the customer's price a suggestion may go. */
let stepLimit = store.get('limit', 60);

const flowHost: FlowHost = {
  esc,
  money,
  chip,
  cardHtml,
  register: (g) => void scanGroups.set(g.key, g),
  async loadKind(kind) {
    const preset = PRESETS.find((p) => p.id === (kind === 'phone' ? 'phones' : 'tablets'))!;
    const found = demo ? DEMO_HITS.filter((h) => (kind === 'phone' ? /iphone|android phones/i : /ipad|^tablets -/i).test(h.categoryFriendlyName ?? '')) : (await search('', branch, preset)).hits;
    return found.map((h, i) => toItem(h, i, ctx)).filter((it) => it.kind === kind);
  },
  scanned: (id) => scanResults.get(id)?.item,
  branch: () => branch,
  limit: () => stepLimit,
  recent: () => store.get<string[]>('recent', []),
  categories: () => PRESETS.map((p) => [p.id, p.label]),
  demo,
};

$('#results').addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.id === 'pickq') setPickQuery(flowHost, F, $('#results'), el.value);
});

// ------------------------------------------------------------------ barcode scanner

/** null = the code is not a product (a serial sticker, say). */
const scanResults = new Map<string, { item: Item; here: boolean } | null>();
const scanGroups = new Map<string, Group>();
const scanOrder: string[] = [];
const scanPending = new Set<string>();
const scanQueue = new Set<string>();
let scanTimer = 0;
let scanner: Scanner | null = null;

function renderTray(): void {
  const tray = document.getElementById('scanTray');
  if (!tray) return;
  if (!scanOrder.length) {
    tray.innerHTML = `<p class="summary">${demo ? 'Demo mode can’t look up labels — remove ?demo from the address.' : 'Scanned items appear here with their current price.'}</p>`;
    return;
  }
  const cards = scanOrder.map((id) => {
    const here = scanResults.get(id)?.here;
    return cardHtml(scanGroups.get('scan:' + id)!, here ? `Listed in stock at ${branch}` : `Not listed in ${branch}'s online stock`);
  });
  tray.innerHTML = `<p class="summary">${scanOrder.length} scanned · tap for details</p><ul class="list">${cards.join('')}</ul>`;
}

async function flushScans(): Promise<void> {
  const ids = [...scanQueue];
  scanQueue.clear();
  try {
    const r = demo ? { hits: [] as Hit[], here: new Set<string>() } : await lookupIds(ids, branch);
    for (const id of ids) {
      const hit = r.hits.find((h) => String(h.boxId) === id);
      if (!hit) {
        scanResults.set(id, null);
        continue;
      }
      const item = toItem(hit, 0, ctx);
      scanResults.set(id, { item, here: r.here.has(id) });
      scanGroups.set('scan:' + id, { key: 'scan:' + id, items: [item], head: item, min: item.price, max: item.price });
      scanOrder.unshift(id);
      // Browsers ignore (and log) vibration before the first tap.
      if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
    }
  } catch {
    /* offline: leave the codes unresolved so the next sighting retries */
  }
  for (const id of ids) scanPending.delete(id);
  renderTray();
  scanner?.refresh();
}

const scanHost: ScanHost = {
  onCode(code) {
    if (scanResults.has(code) || scanPending.has(code)) return;
    scanPending.add(code);
    scanQueue.add(code);
    clearTimeout(scanTimer);
    // A cabinet shot finds many labels at once; one request covers them all.
    scanTimer = window.setTimeout(() => void flushScans(), 80);
  },
  labelFor(code) {
    const r = scanResults.get(code);
    if (r === null) return null;
    if (!r) return scanPending.has(code) ? undefined : null;
    return `${r.item.title}${r.item.storage ? ' ' + r.item.storage.split(' ')[0] : ''} · ${money(r.item.price)}`;
  },
  onPick(code) {
    const card = document.querySelector<HTMLElement>(`#scanTray .card[data-key="scan:${CSS.escape(code)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!card.classList.contains('open')) card.querySelector<HTMLElement>('.card-main')?.click();
  },
};

async function openScan(): Promise<Scanner> {
  const dialog = $<HTMLDialogElement>('#scanner');
  if (scanner && dialog.open) return scanner;
  const { openScanner } = await import('./scan.ts');
  scanner = openScanner(dialog, scanHost);
  dialog.addEventListener('close', () => (scanner = null), { once: true });
  renderTray();
  return scanner;
}

// ------------------------------------------------------------------ actions

function apply(patch: Partial<Filters>, refetch = false): void {
  Object.assign(F, patch);
  writeHash();
  shown = PAGE;
  if (refetch) void load();
  else render();
  if (sheetOpen()) void openSheet();
}

function remember(q: string): void {
  const t = q.trim();
  if (t.length < 2) return;
  const list = store.get<string[]>('recent', []).filter((r) => r.toLowerCase() !== t.toLowerCase());
  store.set('recent', [t, ...list].slice(0, 8));
}

const toggleIn = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const v = el.dataset.v ?? '';
  switch (el.dataset.act) {
    case 'preset':
      apply({ preset: F.preset === v ? '' : v, brands: [], grades: [], fx: [], mode: '' }, true);
      window.scrollTo({ top: 0 });
      break;
    case 'max':
      apply({ max: F.max === Number(v) ? 0 : Number(v) });
      break;
    case 'up':
      apply({ up: F.up === Number(v) ? 0 : Number(v) });
      break;
    case 'perf':
      apply({ perf: F.perf === Number(v) ? 0 : Number(v) });
      break;
    case 'fx': {
      // One choice per group: picking 128GB+ replaces 64GB+.
      const group = facetGroups().find((g) => g.options.some((o) => o.id === v));
      const others = F.fx.filter((id) => !group?.options.some((o) => o.id === id));
      apply({ fx: F.fx.includes(v) ? others : [...others, v] });
      break;
    }
    case 'brand':
      apply({ brands: toggleIn(F.brands, v) });
      break;
    case 'grade':
      apply({ grades: toggleIn(F.grades, v) });
      break;
    case 'group':
      grouped = !grouped;
      store.set('group', grouped);
      apply({});
      break;
    case 'reset':
      apply({ max: 0, up: 0, perf: 0, sort: 'rel', brands: [], grades: [], fx: [] });
      break;
    case 'clear':
      apply({ q: '' }, true);
      $<HTMLInputElement>('#q').value = '';
      $<HTMLInputElement>('#q').focus();
      break;
    case 'door-up':
      resetPickQuery();
      apply({ ...DEFAULTS, mode: 'up' }, true);
      // Same tap, so phones open the keyboard straight away.
      document.getElementById('pickq')?.focus();
      break;
    case 'flow-home':
      apply({ ...DEFAULTS }, true);
      window.scrollTo({ top: 0 });
      break;
    case 'pick':
      apply({ ...DEFAULTS, mode: 'up', pick: v }, true);
      window.scrollTo({ top: 0 });
      break;
    case 'pick-clear':
      resetPickQuery();
      apply({ pick: '' }, true);
      document.getElementById('pickq')?.focus();
      break;
    case 'stepup':
      $<HTMLDialogElement>('#scanner').close();
      apply({ ...DEFAULTS, mode: 'up', pick: v }, true);
      window.scrollTo({ top: 0 });
      break;
    case 'bud':
      apply({ ...(F.mode === 'fit' ? {} : DEFAULTS), mode: 'fit', bud: F.mode === 'fit' && F.bud === Number(v) ? 0 : Number(v) }, true);
      break;
    case 'ftype':
      apply({ ft: v as FitType }, true);
      break;
    case 'need':
      apply({ need: F.need.includes(v) ? F.need.replace(v, '') : F.need + v }, true);
      break;
    case 'limit':
      stepLimit = Number(v) || 60;
      store.set('limit', stepLimit);
      apply({}, Boolean(F.mode));
      break;
    case 'recent':
      apply({ ...DEFAULTS, q: v }, true);
      break;
    case 'retry':
      void load(true);
      break;
    case 'home':
      apply({ ...DEFAULTS }, true);
      window.scrollTo({ top: 0 });
      break;
    case 'scan':
      void openScan();
      break;
    case 'similar':
      $<HTMLDialogElement>('#scanner').close();
      apply({ ...DEFAULTS, q: v }, true);
      window.scrollTo({ top: 0 });
      break;
    case 'more':
      void openSheet();
      break;
    case 'toggle': {
      const li = el.closest<HTMLElement>('.card')!;
      const g = groups.find((x) => x.key === li.dataset.key) ?? scanGroups.get(li.dataset.key ?? '');
      if (!g) break;
      const open = li.classList.toggle('open');
      el.setAttribute('aria-expanded', String(open));
      if (open) {
        li.insertAdjacentHTML('beforeend', detailHtml(g));
        if (F.q) remember(F.q);
      } else li.querySelector('.detail')?.remove();
      break;
    }
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.dataset.act === 'sort') apply({ sort: el.value as Sort });
  if (el.dataset.act === 'maxInput') apply({ max: Math.max(0, Number(el.value) || 0) });
  if (el.dataset.act === 'budInput') apply({ bud: Math.max(0, Number(el.value) || 0) }, true);
  if (el.dataset.act === 'limitInput') {
    stepLimit = Math.max(5, Number(el.value) || 60);
    store.set('limit', stepLimit);
    apply({}, Boolean(F.mode));
  }
  if (el.dataset.act === 'store') {
    const name = el.value.trim();
    if (name && name !== branch) {
      branch = name;
      store.set('store', branch);
      apply({ brands: [], grades: [] }, true);
    }
  }
});

let typing = 0;
$('#q').addEventListener('input', (ev) => {
  const q = (ev.target as HTMLInputElement).value;
  $('#clear').hidden = !q;
  clearTimeout(typing);
  typing = window.setTimeout(() => apply({ q, brands: [], grades: [], fx: [], mode: '' }, true), 160);
});

$('#form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $<HTMLInputElement>('#q');
  clearTimeout(typing);
  remember(input.value);
  if (input.value !== F.q) apply({ q: input.value, mode: '' }, true);
  input.blur();
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === '/' && !/input|select|textarea/i.test((ev.target as HTMLElement).tagName)) {
    ev.preventDefault();
    $<HTMLInputElement>('#q').focus();
  }
});

// Tapping the backdrop closes the sheet.
$('#sheet').addEventListener('click', (ev) => {
  if (ev.target === ev.currentTarget) (ev.currentTarget as HTMLDialogElement).close();
});

// Stock moves while the phone is in a pocket: on return, anything over a minute old is fetched again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - loadedAt < 60_000 || isHome()) return;
  clearCache();
  clearStock();
  loadedAt = Date.now();
  void load(true);
});

window.addEventListener('hashchange', () => {
  readHash();
  $<HTMLInputElement>('#q').value = F.q;
  void load();
});

// ------------------------------------------------------------------ boot

readHash();
$<HTMLInputElement>('#q').value = F.q;
void load();
// Handy when checking parsing against live data from the dev console.
if (import.meta.env.DEV) Object.assign(window, { shelf: { items: () => items, hits: () => hits, openScan } });
if (!F.mode && matchMedia('(hover: hover) and (pointer: fine)').matches) $<HTMLInputElement>('#q').focus();

// Keep lifecycle data current without anyone having to redeploy.
if (Date.now() - Date.parse(db.at) > 7 * 864e5) {
  const refresh = (): void => {
    fetchEolDb()
      .then((fresh) => {
        db = fresh;
        store.set('eol', fresh);
        ctx = makeCtx(db);
        if (hits.length) {
          items = hits.map((h, i) => toItem(h, i, ctx));
          render();
        }
      })
      .catch(() => {
        /* keep using the bundled snapshot */
      });
  };
  window.setTimeout(refresh, 1500);
}
