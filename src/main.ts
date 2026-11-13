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

type Sort = 'rel' | 'pop' | 'price' | 'priceDesc' | 'rated' | 'perf' | 'value' | 'life';

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
  ['pop', 'Most popular'],
  ['price', 'Price: low to high'],
  ['priceDesc', 'Price: high to low'],
  ['rated', 'Top rated'],
  ['perf', 'Fastest first'],
  ['value', 'Best value (speed per £)'],
  ['life', 'Longest update support'],
];
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

/** What the current results mostly are, which decides the filters, budgets and sorts worth offering. */
type Shelf = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'console' | 'game' | 'film' | 'tech' | '';

interface Facet {
  id: string;
  label: string;
  test(it: Item): boolean;
  /** Applied by the search service (matching any one value), for categories too big to fetch whole. */
  server?: string[];
}
interface FacetGroup {
  name: string;
  /** Options also shown in the quick row above results. */
  quick?: string[];
  options: Facet[];
}

const where = (id: string, label: string, test: (it: Item) => boolean): Facet => ({ id, label, test });
const atLeast = (key: 'storageGb' | 'ramGb', id: string, n: number, label: string): Facet => where(id, label, (it) => it[key] >= n);
const system = (id: string, label: string, os: string): Facet => where(id, label, (it) => it.os === os);
const inCategory = (id: string, label: string, re: RegExp): Facet => where(id, label, (it) => re.test(it.category));
const named = (id: string, label: string, re: RegExp): Facet => where(id, label, (it) => re.test(it.name));
const chipset = (id: string, label: string, re: RegExp): Facet => where(id, label, (it) => re.test(it.cpu));
/** Filtered by CeX's own attributes on the server, e.g. served('fdvd', 'DVD', 'productLineName:DVD'). */
const served = (id: string, label: string, ...values: string[]): Facet => ({ id, label, test: () => true, server: values });

const STORAGE_MOBILE: FacetGroup = {
  name: 'Storage',
  quick: ['st128'],
  options: [atLeast('storageGb', 'st64', 64, '64GB+'), atLeast('storageGb', 'st128', 128, '128GB+'), atLeast('storageGb', 'st256', 256, '256GB+')],
};
const MEMORY: FacetGroup = {
  name: 'Memory',
  quick: ['ram8', 'ram16'],
  options: [atLeast('ramGb', 'ram8', 8, '8GB RAM+'), atLeast('ramGb', 'ram16', 16, '16GB RAM+'), atLeast('ramGb', 'ram32', 32, '32GB RAM+')],
};
const STORAGE_PC: FacetGroup = {
  name: 'Storage',
  quick: ['ss256'],
  options: [atLeast('storageGb', 'ss256', 256, '256GB+'), atLeast('storageGb', 'ss512', 512, '512GB+'), atLeast('storageGb', 'ss1000', 1000, '1TB+')],
};
const PROCESSOR: FacetGroup = {
  name: 'Processor',
  options: [
    chipset('ci3', 'Core i3', /\bi3[- ]?\d/i),
    chipset('ci5', 'Core i5', /\bi5[- ]?\d|ultra\s*5/i),
    chipset('ci7', 'Core i7 or i9', /\bi[79][- ]?\d|ultra\s*[79]/i),
    chipset('ryz', 'Ryzen', /ryzen/i),
    chipset('apm', 'Apple M-series', /^m[1-5]\b/i),
    chipset('bud', 'Budget chip', /cel|pent|atom|athlon|^n\d{2,3}\b|^\d{4}[uy]?$/i),
  ],
};
const WINDOWS = [named('w11', 'Windows 11', /\bW(in\w*\s*)?11\b/i), named('w10', 'Windows 10', /\bW(in\w*\s*)?10\b/i)];
const GRAPHICS: FacetGroup = { name: 'Graphics', quick: ['gpu'], options: [where('gpu', 'Graphics card', (it) => it.gpu)] };
const isMini = (it: Item): boolean => /\b(mini|micro|tiny|nuc|usff|sff)\b/i.test(it.name);
const isAllInOne = (it: Item): boolean => it.screen > 0 || /\baio\b|imac|all-in-one/i.test(it.name);
const MODERN_CONSOLE = /playstation[45]|xbox (series|one)|switch/i;

const FACETS: Record<Exclude<Shelf, ''>, FacetGroup[]> = {
  phone: [
    { name: 'System', quick: ['ios', 'and'], options: [system('ios', 'iPhone', 'iOS'), system('and', 'Android', 'Android')] },
    STORAGE_MOBILE,
    {
      name: 'Size',
      options: [where('pcomp', 'Compact (under 6″)', (it) => it.screen > 0 && it.screen < 6), where('pbig', 'Large (6.5″ and up)', (it) => it.screen >= 6.5)],
    },
    { name: 'Battery', quick: ['bat'], options: [where('bat', 'Big battery', (it) => (it.specs?.mah ?? 0) >= 4500)] },
    {
      name: 'Camera',
      options: [where('uw', 'Ultra-wide camera', (it) => Boolean(it.specs?.ultrawide)), where('zoom', 'Zoom camera', (it) => Boolean(it.specs?.zoom))],
    },
  ],
  tablet: [
    { name: 'System', quick: ['ipad', 'andt'], options: [system('ipad', 'iPad', 'iPadOS'), system('andt', 'Android', 'Android'), system('wint', 'Windows', 'Windows')] },
    STORAGE_MOBILE,
    {
      name: 'Screen',
      quick: ['scl'],
      options: [
        where('scs', 'Under 9″', (it) => it.screen > 0 && it.screen < 9),
        where('scm', '9″ to 12″', (it) => it.screen >= 9 && it.screen < 12),
        where('scl', '12″ and up', (it) => it.screen >= 12),
      ],
    },
    { name: 'Connection', options: [where('wifi', 'Wi-Fi only', (it) => !it.cellular), where('sim', 'Takes a SIM', (it) => it.cellular)] },
  ],
  laptop: [
    { name: 'System', quick: ['w11', 'mac'], options: [...WINDOWS, system('mac', 'Mac', 'macOS'), system('cros', 'Chromebook', 'ChromeOS')] },
    PROCESSOR,
    MEMORY,
    STORAGE_PC,
    {
      name: 'Screen',
      options: [
        where('l13', '13″ or smaller', (it) => it.screen > 0 && it.screen < 14),
        where('l14', '14″', (it) => it.screen >= 14 && it.screen < 15),
        where('l15', '15″ to 16″', (it) => it.screen >= 15 && it.screen < 17),
        where('l17', '17″ and up', (it) => it.screen >= 17),
      ],
    },
    GRAPHICS,
  ],
  desktop: [
    { name: 'System', quick: ['w11', 'mac'], options: [...WINDOWS, system('mac', 'Mac', 'macOS')] },
    {
      name: 'Type',
      quick: ['mini', 'aio'],
      options: [
        where('mini', 'Mini PC', (it) => isMini(it) && !isAllInOne(it)),
        where('aio', 'All-in-one', isAllInOne),
        where('tower', 'Tower', (it) => !isMini(it) && !isAllInOne(it)),
      ],
    },
    PROCESSOR,
    MEMORY,
    STORAGE_PC,
    GRAPHICS,
  ],
  console: [
    {
      name: 'Console',
      quick: ['cps5', 'cps4', 'cxs', 'cxo', 'csw'],
      options: [
        inCategory('cps5', 'PS5', /playstation5/i),
        inCategory('cps4', 'PS4', /playstation4/i),
        inCategory('cxs', 'Xbox Series', /xbox series/i),
        inCategory('cxo', 'Xbox One', /xbox one/i),
        inCategory('csw', 'Switch', /switch/i),
        inCategory('chh', 'Handheld', /3ds|nintendo ds|psp|vita|game ?boy|game gear|lynx/i),
        where('cret', 'Retro and older', (it) => !MODERN_CONSOLE.test(it.category)),
      ],
    },
    {
      name: 'Packaging',
      quick: ['boxed'],
      options: [
        where('boxed', 'Boxed', (it) => it.condition === 'Boxed'),
        where('unboxed', 'Unboxed', (it) => it.condition === 'Unboxed'),
        where('disc', 'Discounted', (it) => it.condition === 'Discounted'),
      ],
    },
    { name: 'Edition', options: [named('cdig', 'Digital (no disc drive)', /digital/i)] },
    { name: 'Storage', options: [atLeast('storageGb', 'c500', 500, '500GB+'), atLeast('storageGb', 'c1tb', 1000, '1TB+')] },
  ],
  game: [
    {
      name: 'Platform',
      quick: ['gps5', 'gps4', 'gsw', 'gxs', 'gxo'],
      options: [
        served('gps5', 'PS5', 'productLineName:PlayStation 5'),
        served('gps4', 'PS4', 'productLineName:PlayStation 4'),
        served('gsw', 'Switch', 'productLineName:Switch'),
        served('gsw2', 'Switch 2', 'productLineName:Switch 2'),
        served('gxs', 'Xbox Series', 'productLineName:Xbox Series'),
        served('gxo', 'Xbox One', 'productLineName:Xbox One'),
        served('gpc', 'PC', 'productLineName:PC Gaming'),
        served('gps3', 'PS3', 'productLineName:PlayStation 3'),
        served('gx360', 'Xbox 360', 'productLineName:Xbox 360'),
        served('gwii', 'Wii', 'productLineName:Wii'),
        served('gds', 'DS', 'productLineName:DS'),
        served('g3ds', '3DS', 'productLineName:3DS'),
        served('gps2', 'PS2', 'productLineName:PlayStation 2'),
        served('gretro', 'Retro', 'productLineName:Retro Gaming'),
      ],
    },
    {
      name: 'Age rating',
      quick: ['pg7'],
      options: [
        served('pg7', 'Family (PEGI 3 or 7)', 'PEGI Certificate:3+', 'PEGI Certificate:7+'),
        served('pg12', 'PEGI 12', 'PEGI Certificate:12+'),
        served('pg16', 'PEGI 16', 'PEGI Certificate:16+'),
        served('pg18', 'PEGI 18', 'PEGI Certificate:18+'),
      ],
    },
    {
      name: 'Genre',
      options: [
        served('gadv', 'Adventure', 'Genre:Adventure'),
        served('gsho', 'Shooter', "Genre:Shoot 'Em Up"),
        served('gspo', 'Sport', 'Genre:Sport'),
        served('grac', 'Racing', 'Genre:Racing'),
        served('gfig', 'Fighting', "Genre:Beat 'Em Up", 'Genre:Combat Game'),
        served('gpla', 'Platformer', 'Genre:Platform'),
        served('gstr', 'Strategy', 'Genre:Strategy'),
        served('gpuz', 'Puzzle', 'Genre:Puzzle'),
        served('grhy', 'Music and rhythm', 'Genre:Rhythm'),
        served('gsim', 'Simulation', 'Genre:Simulation'),
      ],
    },
  ],
  film: [
    {
      name: 'Format',
      quick: ['fdvd', 'fblu', 'f4k'],
      options: [served('fdvd', 'DVD', 'productLineName:DVD'), served('fblu', 'Blu-ray', 'productLineName:Blu-Ray'), served('f4k', '4K', 'categoryFriendlyName:Blu-Ray 4K')],
    },
    {
      name: 'Type',
      quick: ['fkid', 'ftv'],
      options: [
        served('ffilm', 'Films', 'categoryFriendlyName:DVD Movies', 'categoryFriendlyName:Blu-Ray Movies', 'categoryFriendlyName:Blu-Ray 4K', 'categoryFriendlyName:DVD World Cinema', 'categoryFriendlyName:Blu-Ray World Cinema'),
        served('ftv', 'TV and documentaries', 'categoryFriendlyName:DVD TV & Documentary', 'categoryFriendlyName:Blu-Ray TV & Documentary'),
        served('fkid', 'Kids', 'categoryFriendlyName:DVD Kids', 'categoryFriendlyName:Blu-Ray Kids'),
        served('fani', 'Anime', 'categoryFriendlyName:Blu-Ray Anime', 'categoryFriendlyName:DVD Anime'),
      ],
    },
    {
      name: 'Certificate',
      options: [
        served('bbu', 'U or PG', 'Age Rating (BBFC):U', 'Age Rating (BBFC):Uc', 'Age Rating (BBFC):PG'),
        served('bb12', '12', 'Age Rating (BBFC):12'),
        served('bb15', '15', 'Age Rating (BBFC):15'),
        served('bb18', '18', 'Age Rating (BBFC):18'),
      ],
    },
    {
      name: 'Genre',
      options: [
        served('fact', 'Action', 'Genre:Action'),
        served('fcom', 'Comedy', 'Genre:Comedy'),
        served('fdra', 'Drama', 'Genre:Drama'),
        served('fhor', 'Horror', 'Genre:Horror'),
        served('fsci', 'Sci-fi', 'Genre:Sci-Fi'),
        served('fthr', 'Thriller', 'Genre:Thriller'),
        served('fanm', 'Animation', 'Genre:Animated Feature', 'Genre:Animation'),
      ],
    },
  ],
  tech: [
    {
      name: 'Type',
      quick: ['thead', 'twear', 'tcam', 'tsmart'],
      options: [
        served('thead', 'Headphones', 'productLineName:Headphones'),
        served('twear', 'Watches and wearables', 'productLineName:Wearable Tech'),
        served('tcam', 'Cameras', 'productLineName:Photography'),
        served('tsmart', 'Smart home', 'productLineName:Smart Tech'),
        served('tport', 'Portable players', 'productLineName:Portable Entertainment'),
        served('tmus', 'Music tech', 'productLineName:Music Tech'),
        served('tmem', 'Memory cards', 'productLineName:Memory Cards'),
        served('tgad', 'Gadgets', 'productLineName:Gadgets'),
      ],
    },
    { name: 'Show', quick: ['noacc'], options: [where('noacc', 'Hide accessories', (it) => !/accessor|batter|cables?|chargers?|cases?\b/i.test(it.category))] },
  ],
};

/** Price steps that suit what each category actually costs. */
const BUDGET_STEPS: Record<Shelf, number[]> = {
  phone: [50, 100, 150, 200, 300, 500],
  tablet: [75, 100, 150, 200, 300, 500],
  laptop: [150, 250, 350, 500, 750, 1000],
  desktop: [150, 250, 350, 500, 750, 1000],
  console: [50, 100, 150, 250, 350, 450],
  game: [5, 10, 15, 20, 30, 40],
  film: [1, 2, 5, 10, 20],
  tech: [25, 50, 100, 150, 250],
  '': [20, 50, 100, 200, 300, 500],
};

function shelfOf(it: Item): Shelf {
  if (it.kind !== 'other') return it.kind;
  if (/consoles?$/i.test(it.category)) return 'console';
  if (/(games|software)$/i.test(it.category)) return 'game';
  if (it.superCat === 'Film & TV') return 'film';
  if (it.superCat === 'Electronics') return 'tech';
  return '';
}

/** Facet filters the search service must apply for the current selection: each inner list is one "any of". */
const serverFacets = (): string[][] =>
  Object.values(FACETS)
    .flat()
    .flatMap((g) => g.options)
    .filter((o) => o.server && F.fx.includes(o.id))
    .map((o) => o.server!);

/** A category chip decides it outright; a free-text search adapts when most results are one kind. */
function shelf(): Shelf {
  const byPreset: Record<string, Shelf> = { phones: 'phone', tablets: 'tablet', laptops: 'laptop', desktops: 'desktop', consoles: 'console', gaming: 'game', film: 'film', electronics: 'tech' };
  if (F.preset) return byPreset[F.preset] ?? '';
  if (!items.length) return '';
  const counts = new Map<Shelf, number>();
  for (const it of items) counts.set(shelfOf(it), (counts.get(shelfOf(it)) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return n >= items.length * 0.6 ? top : '';
}

/** System options that are Apple's own: choosing one already chooses the brand. */
const APPLE_SYSTEMS = ['ios', 'ipad', 'mac'];
const systemOptions = (): Facet[] => facetGroups().find((g) => g.name === 'System')?.options ?? [];

/** Brand choices still meaningful under a new set of filters: none under an Apple system, no Apple otherwise. */
function brandsFor(fx: string[]): string[] {
  const sys = systemOptions();
  if (!sys.length) return F.brands;
  if (fx.some((id) => APPLE_SYSTEMS.includes(id))) return [];
  const other = sys.find((o) => !APPLE_SYSTEMS.includes(o.id) && fx.includes(o.id));
  return F.brands.filter((b) => b.toLowerCase() !== 'apple' && (!other || items.some((it) => it.brand === b && other.test(it))));
}

/** Phones and tablets are the only things sold on how long they will keep getting updates. */
const isMobile = (s: Shelf): boolean => s === 'phone' || s === 'tablet';
/** Speed ratings exist for anything with a processor we can read. */
const isDevice = (s: Shelf): boolean => isMobile(s) || s === 'laptop' || s === 'desktop';
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

function writeHash(push = false): void {
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
  const url = location.pathname + location.search + (h ? '#' + h : '');
  // A step that Back should undo gets its own history entry; filter tweaks and typing do not.
  // An entry left behind by a closed sheet or scanner is reused rather than stacked on.
  if (push && !history.state?.ui && url !== location.pathname + location.search + location.hash) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
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
      const r = await search({ q: F.q, store: branch, preset: PRESETS.find((p) => p.id === F.preset), signal: aborter.signal, fresh, extra: serverFacets(), max: F.max, order: F.sort });
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
  if (sheetOpen()) void openSheet();
}

function compute(): void {
  const now = Date.now();
  hiddenUnknown = 0;
  const kept: Item[] = [];
  const active = facetGroups().flatMap((g) => g.options).filter((o) => F.fx.includes(o.id));
  const sh = shelf();
  for (const it of items) {
    if (F.max && it.price > F.max) continue;
    if (active.some((o) => !o.test(it))) continue;
    if (F.up && isMobile(sh)) {
      const s = it.support;
      if (s.status === 'unknown') {
        hiddenUnknown++;
        continue;
      }
      if (!getsUpdates(s)) continue;
      if (F.up === 2 && (s.status !== 'ok' || (s.until !== undefined && s.until - now < 2 * YEAR))) continue;
    }
    if (F.perf && isDevice(sh) && (!it.perf || it.perf.tier < F.perf)) continue;
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
    // Popularity, rating and price order come from the search service, so its order is kept.
    pop: rel,
    rated: rel,
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

const CARET = '<svg class="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5"/></svg>';

/** A chip that opens one of the app's own menus. `key` says which (see openPicker). */
function picker(key: string, label: string, on: boolean, aria: string): string {
  return `<button type="button" class="chip pick" data-act="menu" data-v="${esc(key)}" aria-haspopup="menu" aria-expanded="false" aria-pressed="${on}" title="${esc(aria)}">${esc(label)}${CARET}</button>`;
}

function filterControls(inSheet: boolean): string {
  const sh = shelf();
  const steps = BUDGET_STEPS[sh];
  const budget = steps.map((b) => chip('max', b, `£${b}`, F.max === b)).join('');
  const custom = F.max && !steps.includes(F.max) ? chip('max', F.max, `£${F.max}`, true) : '';
  const speed = [
    [3, 'Good+'],
    [4, 'Fast+'],
    [5, 'Top'],
  ]
    .map(([t, l]) => chip('perf', t, `${bars(t as number)}${l}`, F.perf === t))
    .join('');
  const updates = chip('up', 1, 'Still gets updates', F.up === 1) + chip('up', 2, '2+ years left', F.up === 2);
  const device = isDevice(sh);
  const mobile = isMobile(sh);
  const groups = facetGroups();
  const fx = (o: Facet): string => chip('fx', o.id, o.label, F.fx.includes(o.id));
  const sortName = SORTS.find(([v]) => v === F.sort)?.[1] ?? 'Best match';
  const speedName: Record<number, string> = { 3: 'Good+', 4: 'Fast+', 5: 'Top speed' };
  if (!inSheet) {
    // One swipeable row. Sort, price and speed are each one chip with a menu, far shorter than a
    // chip per value. Android opens a menu of the makers in stock, since that is the only system
    // where brand is a separate choice.
    const brandChip = (o: Facet): string => {
      const on = F.fx.includes(o.id);
      const label = on && F.brands.length === 1 ? F.brands[0] : on && F.brands.length > 1 ? `${F.brands.length} brands` : o.label;
      return picker(`brand:${o.id}`, label, on, `${o.label} brand`);
    };
    const quick = groups
      .flatMap((g) => g.options.filter((o) => g.quick?.includes(o.id)).map((o) => (o.id === 'and' || o.id === 'andt' ? brandChip(o) : fx(o))))
      .join('');
    return `<div class="frow bar">
      ${picker('sort', F.sort === 'rel' ? 'Sort' : sortName, F.sort !== 'rel', 'Sort by')}
      ${picker('price', F.max ? `Under £${F.max}` : 'Price', F.max > 0, 'Highest price')}
      ${mobile || device || quick ? '<span class="sep"></span>' : ''}
      ${mobile ? chip('up', F.up || 1, F.up === 2 ? '2+ years left' : 'Still updated', F.up > 0) : ''}
      ${device ? picker('speed', speedName[F.perf] ?? 'Speed', F.perf > 0, 'Lowest speed') : ''}
      ${quick}
    </div>`;
  }
  return `
    <div class="frow wrap"><span class="flabel">Budget — under</span>${budget}${custom}</div>
    ${mobile ? `<div class="frow wrap"><span class="flabel">Updates</span>${updates}</div>` : ''}
    ${device ? `<div class="frow wrap"><span class="flabel">Speed</span>${speed}</div>` : ''}
    ${groups.map((g) => `<div class="frow wrap"><span class="flabel">${g.name}</span>${g.options.map(fx).join('')}</div>`).join('')}
    <div class="frow wrap"><span class="flabel">Sort</span>${picker('sort', sortName, F.sort !== 'rel', 'Sort by')}</div>`;
}

function activeCount(): number {
  // "Android: Samsung" is one choice, not two.
  const brandOnSystem = F.brands.length > 0 && F.fx.some((id) => id === 'and' || id === 'andt') ? 1 : 0;
  return (F.max ? 1 : 0) + (F.up ? 1 : 0) + (F.perf ? 1 : 0) + (F.sort !== 'rel' ? 1 : 0) + F.brands.length + F.grades.length + F.fx.length - brandOnSystem;
}

let tipShown = false;

function renderChrome(): void {
  $('#storeName').textContent = branch;
  const q = $<HTMLInputElement>('#q');
  // While the box has focus it is the source of truth (a slow response must not overwrite typing).
  if (document.activeElement !== q) q.value = F.q;
  q.placeholder = `Search ${branch} stock…`;
  $('#clear').hidden = !F.q;
  $('#presets').innerHTML = PRESETS.map(
    (p) => `<button type="button" class="tab" data-act="preset" data-v="${p.id}" aria-pressed="${F.preset === p.id}">${p.label}</button>`,
  ).join('');
  // Keep the chosen category in view when it sits past the edge of the strip.
  const on = $('#presets').querySelector<HTMLElement>('[aria-pressed="true"]');
  if (on) $('#presets').scrollLeft = Math.max(0, on.offsetLeft - 24);
  // Redrawing the row must not throw it back to the start: the chip just used stays where it was.
  const keep = document.querySelector<HTMLElement>('#filters .frow.bar')?.scrollLeft ?? 0;
  $('#filters').innerHTML = filterControls(false);
  const bar = document.querySelector<HTMLElement>('#filters .frow.bar');
  if (bar) bar.scrollLeft = keep;
  const plain = isHome() || Boolean(F.mode);
  const n = plain ? 0 : activeCount();
  $('#dockFiltersLabel').textContent = plain ? 'Settings' : n ? `Filters · ${n}` : 'Filters';
  $('#dockFilters').classList.toggle('has', n > 0);
  $('#dockHome').classList.toggle('on', isHome());
  // Mention the shortcut a few times, until it has been used.
  const tip = $('#holdTip');
  const seen = store.get('holdTipSeen', 0);
  if (!plain && tip.hidden && !tipShown && seen < 4 && !store.get('holdUsed', false)) {
    tipShown = true;
    tip.hidden = false;
    store.set('holdTipSeen', seen + 1);
    window.setTimeout(() => (tip.hidden = true), 6000);
  }
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
  const why = s.status === 'na' ? '' : `<p class="why st-${s.status}"><b>${it.kind === 'laptop' || it.kind === 'desktop' ? 'System' : 'Updates'}</b>${esc(s.detail)}</p>`;
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
  if (total > hits.length) parts.push(`first ${hits.length} of ${total.toLocaleString('en-GB')} — ${shelf() === 'game' ? 'pick a platform or search' : 'search'} to narrow`);
  // Clearing sits on the count line: one tap from what the filters did to the list.
  const clear = activeCount() ? ' <button type="button" class="link" data-act="reset">Clear all</button>' : '';
  main.innerHTML = `<p class="summary">${parts.join(' · ')}${clear}</p>${activePills()}
    <ul class="list" id="list">${groups.slice(0, shown).map((g) => cardHtml(g)).join('')}</ul>
    <div id="sentinel"></div>`;
  pager.observe($('#sentinel'));
}

function render(): void {
  renderChrome();
  renderStatus();
  renderResults();
  if (menuAnchor && !menuAnchor.isConnected) closeMenu();
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


// ------------------------------------------------------------------ sheet

async function openSheet(): Promise<void> {
  const sheet = $<HTMLDialogElement>('#sheet');
  const draw = (stores: string[] = []): void => {
    // Where the System row already offers Apple (iPhone, iPad, Mac), brand only means the others:
    // Apple is left out, the row hides when an Apple system is chosen, and it narrows to the
    // brands of whichever other system is chosen.
    const sys = systemOptions();
    const appleOn = sys.some((o) => APPLE_SYSTEMS.includes(o.id) && F.fx.includes(o.id));
    const otherOn = sys.find((o) => !APPLE_SYSTEMS.includes(o.id) && F.fx.includes(o.id));
    const counts = new Map<string, number>();
    for (const it of items) {
      if (!it.brand || (sys.length && it.brand.toLowerCase() === 'apple') || (otherOn && !otherOn.test(it))) continue;
      counts.set(it.brand, (counts.get(it.brand) ?? 0) + 1);
    }
    const brands = appleOn ? [] : [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
    const brandLabel = shelf() === 'phone' ? 'Android brand' : 'Brand';
    const grades = ['A', 'B', 'C'].filter((g) => items.some((i) => i.grade === g));
    const plain = isHome() || Boolean(F.mode);
    sheet.innerHTML = `<form method="dialog" class="sheet-in">
      <header><h2>${plain ? 'Settings' : 'Filters'}</h2><button class="icon-btn" value="close" aria-label="Close">${ICON_X}</button></header>
      ${plain ? '' : `${filterControls(true)}
      <div class="frow wrap"><span class="flabel">Max £</span><input class="num" type="number" inputmode="numeric" min="0" step="5" placeholder="Any" value="${F.max || ''}" data-act="maxInput" aria-label="Maximum price in pounds"></div>
      ${brands.length > 1 ? `<div class="frow wrap"><span class="flabel">${brandLabel}</span>${brands.map(([b, n]) => chip('brand', b, `${esc(b)} <em>${n}</em>`, F.brands.includes(b))).join('')}</div>` : ''}
      ${grades.length > 1 ? `<div class="frow wrap"><span class="flabel">Grade</span>${grades.map((g) => chip('grade', g, g, F.grades.includes(g))).join('')}</div>` : ''}
      <h3>Settings</h3>`}
      <div class="frow wrap"><span class="flabel">Step-up limit — how far over their price to suggest</span>${[30, 60, 100, 150].map((l) => chip('limit', l, `£${l}`, stepLimit === l)).join('')}<input class="num" type="number" inputmode="numeric" min="5" step="5" placeholder="Other £" value="${[30, 60, 100, 150].includes(stepLimit) ? '' : stepLimit}" data-act="limitInput" aria-label="Step-up limit in pounds"></div>
      <div class="frow wrap"><span class="flabel">View</span>${chip('group', 1, 'Group colours & grades', grouped)}</div>
      <div class="frow wrap"><span class="flabel">Store</span><input class="text" list="stores" value="${esc(branch)}" data-act="store" aria-label="Store" autocomplete="off"><datalist id="stores">${stores.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
      <p class="fine">Update dates come from endoflife.date (refreshed ${esc(db.at)}); Apple dates are estimates. Speed ratings are approximate chip benchmarks.</p>
      <footer class="sheet-foot">${!plain && activeCount() ? '<button type="button" class="link" data-act="reset">Clear all</button>' : '<span></span>'}<button class="sheet-go" value="close">${plain ? 'Done' : loading ? 'Searching…' : `Show ${matched.toLocaleString('en-GB')} ${matched === 1 ? 'item' : 'items'}`}</button></footer>
    </form>`;
  };
  draw(storeList);
  if (!sheet.open) {
    sheet.showModal();
    history.pushState({ ui: true }, '');
  }
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
    const found = demo ? DEMO_HITS.filter((h) => (kind === 'phone' ? /iphone|android phones/i : /ipad|^tablets -/i).test(h.categoryFriendlyName ?? '')) : (await search({ q: '', store: branch, preset })).hits;
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
  history.pushState({ ui: true }, '');
  dialog.addEventListener('close', () => (scanner = null), { once: true });
  renderTray();
  return scanner;
}

// ------------------------------------------------------------------ bottom bar and hold-to-filter

const ICON_X = '<svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';

/**
 * Filters chosen in the sheet that the filter row cannot show, as pills that switch them off.
 * Everything in the row already shows its own state, so it is not repeated here.
 */
function activePills(): string {
  if (!activeCount()) return '';
  const inRow = new Set(facetGroups().flatMap((g) => g.quick ?? []));
  const pills: string[] = [];
  for (const g of facetGroups()) for (const o of g.options) if (F.fx.includes(o.id) && !inRow.has(o.id)) pills.push(chip('fx', o.id, `${o.label}${ICON_X}`, true));
  // The Android chip names the brand already.
  if (!F.fx.some((id) => id === 'and' || id === 'andt')) for (const b of F.brands) pills.push(chip('brand', b, `${esc(b)}${ICON_X}`, true));
  for (const g of F.grades) pills.push(chip('grade', g, `Grade ${g}${ICON_X}`, true));
  if (!pills.length) return '';
  return `<div class="chips wrap active" aria-label="Other active filters">${pills.join('')}</div>`;
}

interface Quick {
  label: string;
  act: string;
  v: string;
  on: boolean;
}

/** The handful of filters worth a shortcut for what is on screen, most used first (nearest the thumb). */
function quickList(): Quick[] {
  const sh = shelf();
  const out: Quick[] = [];
  if (isMobile(sh)) out.push({ label: 'Still gets updates', act: 'up', v: '1', on: F.up === 1 });
  for (const g of facetGroups()) {
    for (const o of g.options) if (g.quick?.includes(o.id)) out.push({ label: o.label, act: 'fx', v: o.id, on: F.fx.includes(o.id) });
  }
  if (isDevice(sh)) out.push({ label: 'Fast or faster', act: 'perf', v: '4', on: F.perf === 4 });
  const step = BUDGET_STEPS[sh][1];
  out.push({ label: `Under £${step}`, act: 'max', v: String(step), on: F.max === step });
  const list = out.slice(0, 7);
  if (activeCount()) list.push({ label: 'Clear filters', act: 'reset', v: '', on: false });
  return list;
}

const holdEl = $('#hold');
const filtersBtn = $<HTMLButtonElement>('#dockFilters');
let holdTimer = 0;
let holding = false;
let holdMoved = false;
let holdStart = { x: 0, y: 0 };
let hot: HTMLElement | null = null;
/** The tap that ends a hold must not also open the sheet. */
let swallowTap = false;

const ICON_TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/** The filters after tapping a shortcut, worked out the same way the chip handlers do. */
function nextState(q: Quick): Partial<Filters> {
  const n = Number(q.v);
  switch (q.act) {
    case 'up':
      return { up: F.up === n ? 0 : n };
    case 'perf':
      return { perf: F.perf === n ? 0 : n };
    case 'max':
      return { max: F.max === n ? 0 : n };
    case 'fx': {
      const group = facetGroups().find((g) => g.options.some((o) => o.id === q.v));
      const others = F.fx.filter((id) => !group?.options.some((o) => o.id === id));
      const fx = F.fx.includes(q.v) ? others : [...others, q.v];
      return { fx, brands: brandsFor(fx) };
    }
    default:
      return {};
  }
}

/**
 * How many items a shortcut leaves on screen: the current count for one already on, the
 * count after adding it otherwise. Null where the loaded items cannot answer honestly
 * (the search service applies the filter, or only part of the category is loaded).
 */
function countFor(q: Quick): number | null {
  if (q.act === 'reset' || loading || !items.length || total > hits.length) return null;
  if (q.on) return matched;
  const opt = q.act === 'fx' ? facetGroups().flatMap((g) => g.options).find((o) => o.id === q.v) : undefined;
  if (opt?.server) return null;
  const saved = { ...F, fx: [...F.fx], brands: [...F.brands], grades: [...F.grades] };
  const kept = { groups, matched, hiddenUnknown };
  Object.assign(F, nextState(q));
  compute();
  const n = matched;
  Object.assign(F, saved);
  ({ groups, matched, hiddenUnknown } = kept);
  return n;
}

function openHold(): void {
  const list = quickList();
  const reset = list.find((q) => q.act === 'reset');
  // Most used nearest the thumb: the list reads upward from the button.
  const rows = list.filter((q) => q.act !== 'reset').reverse();
  const dock = $('.dock').getBoundingClientRect();
  const where = PRESETS.find((p) => p.id === F.preset)?.label ?? (F.q ? `“${F.q}”` : 'Results');
  const row = (q: Quick): string => {
    const n = countFor(q);
    // A shortcut that would empty the list is shown but cannot be picked.
    const none = n === 0 && !q.on;
    return `<button type="button" class="hold-row"${none ? ' disabled' : ''} role="menuitemcheckbox" aria-checked="${q.on}" data-act="${q.act}" data-v="${esc(q.v)}" aria-pressed="${q.on}">
      <span class="hold-tick">${q.on ? ICON_TICK : ''}</span><span class="hold-label">${esc(q.label)}</span>${n === null ? '' : `<span class="hold-n">${n.toLocaleString('en-GB')}</span>`}
    </button>`;
  };
  holdEl.innerHTML = `<div class="hold-panel" role="menu" aria-label="Quick filters" style="right:${Math.round(window.innerWidth - dock.right)}px;bottom:${Math.round(window.innerHeight - dock.top + 10)}px">
    <p class="hold-head"><span>Quick filters</span><span>${esc(where)}</span></p>
    ${reset ? `<button type="button" class="hold-row quiet" role="menuitem" data-act="reset" data-v=""><span class="hold-tick">${ICON_X}</span><span class="hold-label">Clear all filters</span></button><hr class="hold-sep">` : ''}
    ${rows.map(row).join('')}
  </div>`;
  holdEl.hidden = false;
  document.body.classList.add('holding');
  store.set('holdUsed', true);
  $('#holdTip').hidden = true;
}

function closeHold(): void {
  holdEl.hidden = true;
  holdEl.innerHTML = '';
  document.body.classList.remove('holding');
  hot = null;
}

function setHot(el: HTMLElement | null): void {
  if (el === hot) return;
  hot?.classList.remove('hot');
  hot = el;
  hot?.classList.add('hot');
  if (hot && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
}

/** Open the panel now, holding on to the finger so a slide keeps reporting here. */
function startHold(pointerId: number): void {
  window.clearTimeout(holdTimer);
  if (holding) return;
  holding = true;
  openHold();
  try {
    filtersBtn.setPointerCapture(pointerId);
  } catch {
    /* the finger has already lifted */
  }
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(15);
}

filtersBtn.addEventListener('pointerdown', (ev) => {
  if (isHome() || F.mode) return;
  holdStart = { x: ev.clientX, y: ev.clientY };
  holdMoved = false;
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => startHold(ev.pointerId), 200);
});

filtersBtn.addEventListener('pointermove', (ev) => {
  const dx = ev.clientX - holdStart.x;
  const dy = ev.clientY - holdStart.y;
  const far = Math.hypot(dx, dy);
  if (!holding) {
    // A flick upward off the button is intent on its own: open at once, no waiting.
    if (dy < -10 && -dy > Math.abs(dx)) {
      startHold(ev.pointerId);
      holdMoved = true;
    } else {
      if (far > 14) window.clearTimeout(holdTimer);
      return;
    }
  }
  if (far > 16) holdMoved = true;
  const panel = holdEl.querySelector<HTMLElement>('.hold-panel');
  if (!panel || !holdMoved) return setHot(null);
  const box = panel.getBoundingClientRect();
  // Forgiving sideways: a thumb drifting a little past the panel's edge still counts.
  if (ev.clientX < box.left - 40 || ev.clientY < box.top - 20) return setHot(null);
  let best: HTMLElement | null = null;
  let bestGap = Infinity;
  for (const el of panel.querySelectorAll<HTMLElement>('.hold-row:not(:disabled)')) {
    const b = el.getBoundingClientRect();
    const gap = ev.clientY < b.top ? b.top - ev.clientY : ev.clientY > b.bottom ? ev.clientY - b.bottom : 0;
    if (gap < bestGap) {
      best = el;
      bestGap = gap;
    }
  }
  // Below the last row is the dock: letting go there changes nothing.
  setHot(bestGap <= 18 ? best : null);
});

const endHold = (cancelled: boolean): void => {
  window.clearTimeout(holdTimer);
  if (!holding) return;
  holding = false;
  swallowTap = true;
  window.setTimeout(() => (swallowTap = false), 400);
  if (cancelled) return closeHold();
  if (hot) {
    const chosen = hot;
    closeHold();
    // Same route as tapping a chip, so every shortcut behaves exactly like its filter.
    document.body.append(chosen);
    chosen.click();
    chosen.remove();
  } else if (holdMoved) closeHold();
  // Held without sliding: the panel stays up to be tapped.
};
filtersBtn.addEventListener('pointerup', () => endHold(false));
filtersBtn.addEventListener('pointercancel', () => endHold(true));
filtersBtn.addEventListener('contextmenu', (ev) => ev.preventDefault());
holdEl.addEventListener('click', (ev) => {
  // A tapped shortcut is handled by the shared click handler first; then the menu goes.
  if (ev.target === holdEl || (ev.target as HTMLElement).closest('.hold-item')) window.setTimeout(closeHold, 0);
});

// The header steps aside while reading down a list and returns on the way back up.
let lastY = 0;
window.addEventListener(
  'scroll',
  () => {
    const y = window.scrollY;
    if (Math.abs(y - lastY) < 8) return;
    const typing = document.activeElement instanceof HTMLInputElement;
    document.body.classList.toggle('tuck', y > 140 && y > lastY && !typing);
    lastY = y;
  },
  { passive: true },
);

// The phone's Back button closes whatever is open before it leaves the page.
for (const id of ['#sheet', '#scanner']) {
  $(id).addEventListener('close', () => {
    if (history.state?.ui) history.back();
  });
}
window.addEventListener('popstate', () => {
  closeHold();
  for (const id of ['#sheet', '#scanner']) {
    const d = $<HTMLDialogElement>(id);
    if (d.open) d.close();
  }
});

// ------------------------------------------------------------------ dropdown menus

interface MenuItem {
  v: string;
  label: string;
  /** Right-hand detail: a count, a starting price. */
  meta?: string;
  on?: boolean;
  /** A divider instead of an item. */
  sep?: boolean;
  quiet?: boolean;
}

let menuEl: HTMLDivElement | null = null;
let menuAnchor: HTMLElement | null = null;

function closeMenu(focusAnchor = false): void {
  if (!menuEl) return;
  menuEl.remove();
  menuEl = null;
  menuAnchor?.setAttribute('aria-expanded', 'false');
  if (focusAnchor) menuAnchor?.focus();
  menuAnchor = null;
  document.removeEventListener('pointerdown', menuOutside, true);
  document.removeEventListener('keydown', menuKeys, true);
  window.removeEventListener('scroll', menuScroll, true);
  window.removeEventListener('resize', menuResize);
}

const menuOutside = (ev: Event): void => {
  const t = ev.target as Node;
  if (!menuEl?.contains(t) && !menuAnchor?.contains(t)) closeMenu();
};
const menuScroll = (ev: Event): void => {
  if (!menuEl?.contains(ev.target as Node)) closeMenu();
};
const menuResize = (): void => closeMenu();

function menuKeys(ev: KeyboardEvent): void {
  if (!menuEl) return;
  if (ev.key === 'Escape' || ev.key === 'Tab') {
    if (ev.key === 'Escape') ev.preventDefault();
    closeMenu(ev.key === 'Escape');
    return;
  }
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
  ev.preventDefault();
  const all = [...menuEl.querySelectorAll<HTMLElement>('.menu-item')];
  const at = all.indexOf(document.activeElement as HTMLElement);
  const next =
    ev.key === 'Home' ? 0 : ev.key === 'End' ? all.length - 1 : ev.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
  all[next]?.focus();
}

/** A menu under (or above) the chip that opened it, styled like the rest of the app instead of the browser's own list. */
function openMenu(anchor: HTMLElement, title: string, list: MenuItem[], pick: (v: string) => void): void {
  closeMenu();
  // Inside an open dialog the menu has to live in that dialog, or the dialog would cover it.
  const host = anchor.closest('dialog[open]') ?? document.body;
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', title);
  el.innerHTML =
    `<p class="menu-head">${esc(title)}</p>` +
    list
      .map((i) =>
        i.sep
          ? '<hr class="menu-sep">'
          : `<button type="button" class="menu-item${i.quiet ? ' quiet' : ''}" role="menuitemradio" aria-checked="${Boolean(i.on)}" data-menu-v="${esc(i.v)}"><span class="menu-tick">${i.on ? ICON_TICK : ''}</span><span class="menu-label">${esc(i.label)}</span>${i.meta ? `<span class="menu-meta">${esc(i.meta)}</span>` : ''}</button>`,
      )
      .join('');
  host.append(el);
  const a = anchor.getBoundingClientRect();
  const room = { below: window.innerHeight - a.bottom - 100, above: a.top - 20 };
  const above = el.offsetHeight > room.below && room.above > room.below;
  el.style.maxHeight = `${Math.max(160, above ? room.above : room.below)}px`;
  el.classList.toggle('up', above);
  const w = el.offsetWidth;
  el.style.left = `${Math.round(Math.min(Math.max(12, a.left), window.innerWidth - w - 12))}px`;
  el.style.top = `${Math.round(above ? a.top - 8 - el.offsetHeight : a.bottom + 8)}px`;
  el.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-menu-v]');
    if (!b) return;
    ev.stopPropagation();
    const v = b.dataset.menuV ?? '';
    closeMenu();
    pick(v);
  });
  menuEl = el;
  menuAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('pointerdown', menuOutside, true);
  document.addEventListener('keydown', menuKeys, true);
  window.addEventListener('scroll', menuScroll, true);
  window.addEventListener('resize', menuResize);
  (el.querySelector<HTMLElement>('[aria-checked="true"]') ?? el.querySelector<HTMLElement>('.menu-item'))?.focus({ preventScroll: true });
}

/** What a change would leave on screen, without making it. Null where the loaded items cannot say. */
function preview(patch: Partial<Filters>): { n: number; from: number } | null {
  if (loading || !items.length || total > hits.length) return null;
  const saved = { ...F, fx: [...F.fx], brands: [...F.brands], grades: [...F.grades] };
  const kept = { groups, matched, hiddenUnknown };
  Object.assign(F, patch);
  compute();
  const out = { n: matched, from: groups.length ? Math.min(...groups.map((g) => g.min)) : 0 };
  Object.assign(F, saved);
  ({ groups, matched, hiddenUnknown } = kept);
  return out;
}

const countText = (p: { n: number } | null): string | undefined => (p ? p.n.toLocaleString('en-GB') : undefined);

const sortsFor = (sh: Shelf): [Sort, string][] =>
  SORTS.filter(([v]) => (v === 'life' ? isMobile(sh) : v === 'perf' || v === 'value' ? isDevice(sh) : true));

/** The menus behind the picker chips. `key` is the chip's data-v. */
function openPicker(key: string, anchor: HTMLElement): void {
  const sh = shelf();
  if (key === 'sort') {
    const list = sortsFor(sh).map(([v, l]): MenuItem => ({ v, label: l, on: F.sort === v }));
    return openMenu(anchor, 'Sort by', list, (v) => apply({ sort: v as Sort }, true));
  }
  if (key === 'price') {
    const steps = [...BUDGET_STEPS[sh]];
    if (F.max && !steps.includes(F.max)) steps.push(F.max);
    steps.sort((x, y) => x - y);
    // Prices above the current limit were never fetched, so they cannot be counted.
    const counted = (p: number): string | undefined => (F.max && p > F.max ? undefined : countText(preview({ max: p })));
    const list: MenuItem[] = [
      { v: '0', label: 'Any price', on: !F.max },
      ...steps.map((p): MenuItem => ({ v: String(p), label: `Under £${p}`, meta: counted(p), on: F.max === p })),
    ];
    return openMenu(anchor, 'Price', list, (v) => apply({ max: Number(v) || 0 }, true));
  }
  if (key === 'speed') {
    const list: MenuItem[] = [
      { v: '0', label: 'Any speed', on: !F.perf },
      ...([
        [3, 'Good or faster'],
        [4, 'Fast or faster'],
        [5, 'Top speed only'],
      ] as [number, string][]).map(([t, l]): MenuItem => ({ v: String(t), label: l, meta: countText(preview({ perf: t })), on: F.perf === t })),
    ];
    return openMenu(anchor, 'Speed', list, (v) => apply({ perf: Number(v) || 0 }));
  }
  if (key.startsWith('brand:')) {
    const id = key.slice(6);
    const sys = systemOptions();
    const opt = sys.find((o) => o.id === id);
    if (!opt) return;
    const others = F.fx.filter((x) => !sys.some((o) => o.id === x));
    const withSys = [...others, id];
    const on = F.fx.includes(id);
    // Makers in stock for this system, busiest first, with what each would show and its cheapest item.
    const makers = [...new Set(items.filter((it) => it.brand && opt.test(it)).map((it) => it.brand))]
      .map((b) => ({ b, p: preview({ fx: withSys, brands: [b] }) }))
      .filter((x) => !x.p || x.p.n > 0)
      .sort((x, y) => (y.p?.n ?? 0) - (x.p?.n ?? 0) || x.b.localeCompare(y.b));
    const any = preview({ fx: withSys, brands: [] });
    const list: MenuItem[] = [
      { v: '*', label: `Any ${opt.label} brand`, meta: countText(any), on: on && !F.brands.length },
      { v: '', label: '', sep: true },
      ...makers.map(({ b, p }): MenuItem => ({
        v: b,
        label: b,
        meta: p ? `${p.n.toLocaleString('en-GB')} · from £${p.from}` : undefined,
        on: on && F.brands.length === 1 && F.brands[0] === b,
      })),
    ];
    if (on) list.push({ v: '', label: '', sep: true }, { v: 'off', label: `Show all ${PRESETS.find((p) => p.id === F.preset)?.label.toLowerCase() ?? 'items'}`, quiet: true });
    return openMenu(anchor, `${opt.label} brand`, list, (v) => {
      if (v === 'off') apply({ fx: others, brands: [] });
      else apply({ fx: withSys, brands: v === '*' ? [] : [v] });
    });
  }
}

// ------------------------------------------------------------------ actions

/** `push` marks a move the Back button should undo (a new screen), as opposed to a refinement of this one. */
function apply(patch: Partial<Filters>, refetch = false, push = false): void {
  Object.assign(F, patch);
  writeHash(push);
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
      // Each category has its own filters, price steps and sorts, so none carry over.
      apply({ ...DEFAULTS, q: F.q, preset: F.preset === v ? '' : v }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'max':
      apply({ max: F.max === Number(v) ? 0 : Number(v) }, true);
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
      const fx = F.fx.includes(v) ? others : [...others, v];
      // A platform choice changes what the service returns, so it needs a fresh search.
      apply({ fx, brands: brandsFor(fx) }, Boolean(group?.options.some((o) => o.server)));
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
      apply({ max: 0, up: 0, perf: 0, sort: 'rel', brands: [], grades: [], fx: [] }, true);
      break;
    case 'clear':
      apply({ q: '' }, true);
      $<HTMLInputElement>('#q').value = '';
      $<HTMLInputElement>('#q').focus();
      break;
    case 'door-up':
      resetPickQuery();
      apply({ ...DEFAULTS, mode: 'up' }, true, true);
      // Same tap, so phones open the keyboard straight away.
      document.getElementById('pickq')?.focus();
      break;
    case 'flow-home':
      apply({ ...DEFAULTS }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'pick':
      apply({ ...DEFAULTS, mode: 'up', pick: v }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'pick-clear':
      resetPickQuery();
      apply({ pick: '' }, true);
      document.getElementById('pickq')?.focus();
      break;
    case 'stepup':
      $<HTMLDialogElement>('#scanner').close();
      apply({ ...DEFAULTS, mode: 'up', pick: v }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'bud':
      apply({ ...(F.mode === 'fit' ? {} : DEFAULTS), mode: 'fit', bud: F.mode === 'fit' && F.bud === Number(v) ? 0 : Number(v) }, true, F.mode !== 'fit');
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
      apply({ ...DEFAULTS, q: v }, true, true);
      break;
    case 'retry':
      void load(true);
      break;
    case 'home':
      apply({ ...DEFAULTS }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'scan':
      void openScan();
      break;
    case 'similar':
      $<HTMLDialogElement>('#scanner').close();
      apply({ ...DEFAULTS, q: v }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'menu':
      if (menuAnchor === el) closeMenu();
      else openPicker(v, el);
      break;
    case 'more':
      if (swallowTap) break;
      void openSheet();
      break;
    case 'dock-search': {
      document.body.classList.remove('tuck');
      const box = $<HTMLInputElement>('#q');
      box.focus();
      box.select();
      break;
    }
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
  if (el.dataset.act === 'sort') apply({ sort: el.value as Sort }, true);
  if (el.dataset.act === 'maxInput') apply({ max: Math.max(0, Number(el.value) || 0) }, true);
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
  // The first keystroke from the start screen or a sales flow opens a new screen; the rest refine it.
  typing = window.setTimeout(() => apply({ q, brands: [], grades: [], fx: [], mode: '' }, true, isHome() || Boolean(F.mode)), 160);
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
