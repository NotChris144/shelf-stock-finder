import './styles.css';
import snapshot from './data/eol-snapshot.json';
import { PRESETS, fetchStores, lookupIds, search } from './api.ts';
import { DEMO_HITS } from './demo.ts';
import { fetchEolDb, type EolDb } from './eol.ts';
import { toItem } from './parse.ts';
import type { ScanHost, Scanner } from './scan.ts';
import { makeCtx } from './support.ts';
import type { Hit, Item } from './types.ts';

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
}

const DEFAULTS: Filters = { q: '', preset: '', max: 0, up: 0, perf: 0, sort: 'rel', brands: [], grades: [] };
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

interface Group {
  key: string;
  items: Item[];
  head: Item;
  min: number;
  max: number;
}
let groups: Group[] = [];
let hiddenUnknown = 0;
let matched = 0;

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
  if (!F.q.trim() && !F.preset) {
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
  shown = PAGE;
  render();
}

function compute(): void {
  const now = Date.now();
  hiddenUnknown = 0;
  const kept: Item[] = [];
  for (const it of items) {
    if (F.max && it.price > F.max) continue;
    if (F.up) {
      const s = it.support;
      if (s.status === 'unknown') {
        hiddenUnknown++;
        continue;
      }
      if (s.status !== 'ok' && s.status !== 'warn') continue;
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
  const sort = `<label class="select"><span class="sr">Sort by</span><select data-act="sort">${SORTS.map(
    ([v, l]) => `<option value="${v}"${F.sort === v ? ' selected' : ''}>${l}</option>`,
  ).join('')}</select></label>`;
  const updates = chip('up', 1, 'Still gets updates', F.up === 1) + chip('up', 2, '2+ years left', F.up === 2);
  if (!inSheet) {
    // Two swipeable rows keep results high on a phone screen; the sheet has the labelled version.
    return `
      <div class="frow">${updates}<span class="sep"></span>${speed}</div>
      <div class="frow"><span class="flabel">Under</span>${budget}${custom}<span class="sep"></span>${sort}<button type="button" class="chip ghost" data-act="more">More</button></div>`;
  }
  return `
    <div class="frow wrap"><span class="flabel">Budget — under</span>${budget}${custom}</div>
    <div class="frow wrap"><span class="flabel">Updates</span>${updates}</div>
    <div class="frow wrap"><span class="flabel">Speed</span>${speed}</div>
    <div class="frow wrap"><span class="flabel">Sort</span>${sort}</div>`;
}

function activeCount(): number {
  return (F.max ? 1 : 0) + (F.up ? 1 : 0) + (F.perf ? 1 : 0) + (F.sort !== 'rel' ? 1 : 0) + F.brands.length + F.grades.length;
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
  else if (!F.q.trim() && !F.preset) el.textContent = demo ? 'Demo data' : 'In-stock only';
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

function cardHtml(g: Group, note = ''): string {
  const it = g.head;
  const n = g.items.length;
  const grades = [...new Set(g.items.map((i) => i.grade).filter(Boolean))].sort();
  const gradeTxt = grades.length ? `Grade ${grades.join(', ')}` : '';
  const meta = n > 1 ? [`${n} in stock`, gradeTxt].filter(Boolean).join(' · ') : [it.variant, gradeTxt].filter(Boolean).join(' · ');
  const icon = it.kind === 'phone' || it.kind === 'tablet' ? ICON_PHONE : it.kind === 'other' ? ICON_BOX : ICON_LAPTOP;
  const img = it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" decoding="async" width="64" height="64" onerror="this.remove()">` : '';
  const price = g.max > g.min ? `<small>from</small>${money(g.min)}` : money(g.min);
  return `<li class="card" data-key="${esc(g.key)}">
    <button type="button" class="card-main" data-act="toggle" aria-expanded="false">
      <span class="thumb">${icon}${img}</span>
      <span class="body">
        <span class="title">${esc(it.title)}</span>
        <span class="sub">${esc(it.sub)}</span>
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
        ${note ? `<span class="meta">${esc(note)}</span>` : ''}
        <span class="badges">${supportBadge(it)}${perfBadge(it)}</span>
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
  const similar = scanned && (it.model || it.title) ? `<button type="button" class="chip" data-act="similar" data-v="${esc(it.model || it.title)}">Find similar in stock</button>` : '';
  return `<div class="detail">${priced}${why}${speed}<ul class="variants">${rows}</ul>${similar}</div>`;
}

const QUICK: { title: string; note: string; patch: Partial<Filters> }[] = [
  { title: 'Phones that still get updates', note: 'Cheapest first', patch: { preset: 'phones', up: 1, sort: 'price' } },
  { title: 'Under £100 and still updated', note: 'Phones, fastest first', patch: { preset: 'phones', up: 1, max: 100, sort: 'perf' } },
  { title: 'Best-value phones', note: 'Most speed per pound, updates included', patch: { preset: 'phones', up: 1, sort: 'value' } },
  { title: 'Phones that will last longest', note: 'Under £200, longest support first', patch: { preset: 'phones', up: 1, max: 200, sort: 'life' } },
  { title: 'Laptops on Windows 11 or current macOS', note: 'Cheapest first', patch: { preset: 'laptops', up: 1, sort: 'price' } },
  { title: 'Fastest laptops under £300', note: 'Ranked by processor', patch: { preset: 'laptops', max: 300, sort: 'perf' } },
  { title: 'iPads on the latest iPadOS', note: 'Cheapest first', patch: { preset: 'tablets', q: 'ipad', up: 1, sort: 'price' } },
];

function homeHtml(): string {
  const recent = store.get<string[]>('recent', []);
  return `<section class="home">
    ${demo ? '<p class="note">Demo mode — sample listings, not live stock. Remove <code>?demo</code> from the address for live data.</p>' : ''}
    <h2>Quick answers</h2>
    <div class="quick">${QUICK.map((q, i) => `<button type="button" data-act="quick" data-v="${i}"><b>${q.title}</b><span>${q.note}</span></button>`).join('')}</div>
    ${recent.length ? `<h2>Recent searches</h2><div class="chips wrap">${recent.map((r) => chip('recent', r, esc(r), false)).join('')}</div>` : ''}
    <p class="hint">Type any product above — spelling mistakes are fine. Everything shown is in stock at ${esc(branch)}.</p>
  </section>`;
}

function renderResults(): void {
  const main = $('#results');
  const home = !F.q.trim() && !F.preset;
  $('#filters').hidden = home;
  $('#fab').hidden = home || !filtersOffscreen;
  if (home) {
    main.innerHTML = homeHtml();
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
  $('#fab').hidden = !filtersOffscreen || (!F.q.trim() && !F.preset);
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
      <header><h2>Filters</h2><button class="chip" aria-pressed="true" value="close">Done</button></header>
      ${filterControls(true)}
      <div class="frow wrap"><span class="flabel">Max £</span><input class="num" type="number" inputmode="numeric" min="0" step="5" placeholder="Any" value="${F.max || ''}" data-act="maxInput" aria-label="Maximum price in pounds"></div>
      ${brands.length > 1 ? `<div class="frow wrap"><span class="flabel">Brand</span>${brands.map(([b, n]) => chip('brand', b, `${esc(b)} <em>${n}</em>`, F.brands.includes(b))).join('')}</div>` : ''}
      ${grades.length > 1 ? `<div class="frow wrap"><span class="flabel">Grade</span>${grades.map((g) => chip('grade', g, g, F.grades.includes(g))).join('')}</div>` : ''}
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
      navigator.vibrate?.(40);
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
      apply({ preset: F.preset === v ? '' : v, brands: [], grades: [] }, true);
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
      apply({ max: 0, up: 0, perf: 0, sort: 'rel', brands: [], grades: [] });
      break;
    case 'clear':
      apply({ q: '' }, true);
      $<HTMLInputElement>('#q').value = '';
      $<HTMLInputElement>('#q').focus();
      break;
    case 'quick':
      apply({ ...DEFAULTS, ...QUICK[Number(v)].patch }, true);
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
  typing = window.setTimeout(() => apply({ q, brands: [], grades: [] }, true), 160);
});

$('#form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const input = $<HTMLInputElement>('#q');
  clearTimeout(typing);
  remember(input.value);
  if (input.value !== F.q) apply({ q: input.value }, true);
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
if (matchMedia('(hover: hover) and (pointer: fine)').matches) $<HTMLInputElement>('#q').focus();

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
