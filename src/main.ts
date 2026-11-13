import './styles.css';
import snapshot from './data/eol-snapshot.json';
import sheetFile from './data/specs.json';
import { PRESETS, addonStock, clearCache, fetchStores, lookupIds, sampleStock, search } from './api.ts';
import { fillActivity, forgetLog } from './activity.ts';
import { slotsFor } from './addons.ts';
import { findCover, forget, remembered, spineOf, type Cover } from './covers.ts';
import { DEMO_HITS } from './demo.ts';
import { fetchEolDb, type EolDb } from './eol.ts';
import { FOCI, clearAddons, clearStock, homeHtml, moreAddons, renderFlow, resetPickQuery, setPickQuery, toggleAddon, type FlowHost } from './flows.ts';
import { getsUpdates, type FitType } from './sell.ts';
import { cameraText, useSheets, waterTight, type SheetFile } from './specs.ts';
import { toItem } from './parse.ts';
import type { ScanHost, Scanner } from './scan.ts';
import { makeCtx } from './support.ts';
import type { Group, Hit, Item } from './types.ts';

// ------------------------------------------------------------------ helpers

// Spec sheets are in place before any stock is read.
useSheets(sheetFile as unknown as SheetFile);

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
  /** Sales flow: '' (search), 'up' (step up from a pick), 'fit' (match a budget) or 'add' (add-ons for an item). */
  mode: '' | 'up' | 'fit' | 'add' | 'in' | 'sold';
  /** Which kind of item the activity screens are narrowed to ('' = all). */
  ac: string;
  pick: string;
  bud: number;
  ft: FitType;
  need: string;
  /** What the customer said matters most, for the step-up options ('' = no steer). */
  fo: string;
}

const DEFAULTS: Filters = { q: '', preset: '', max: 0, up: 0, perf: 0, sort: 'rel', brands: [], grades: [], fx: [], mode: '', pick: '', bud: 0, ft: 'phone', need: 'u', fo: '', ac: '' };
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
  /** Reads the model's full spec sheet, so it can only be trusted when most of the shelf has one. */
  sheet?: boolean;
}
interface FacetGroup {
  name: string;
  /** Options also shown in the quick row above results. */
  quick?: string[];
  options: Facet[];
}

const where = (id: string, label: string, test: (it: Item) => boolean): Facet => ({ id, label, test });
/** A feature only a full spec sheet records: without one, "has it" and "has not" are both unknown. */
const onSheet = (id: string, label: string, test: (it: Item) => boolean): Facet => ({ id, label, test, sheet: true });
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
    {
      name: 'Battery',
      quick: ['bat'],
      options: [
        where('bat', 'Big battery', (it) => (it.specs?.mah ?? 0) >= 4500),
        onSheet('fast', 'Fast charging (25W+)', (it) => (it.specs?.sheet?.w ?? 0) >= 25),
        onSheet('wl', 'Wireless charging', (it) => it.specs?.sheet?.wl !== undefined),
      ],
    },
    {
      name: 'Camera',
      options: [where('uw', 'Ultra-wide camera', (it) => Boolean(it.specs?.ultrawide)), where('zoom', 'Zoom camera', (it) => Boolean(it.specs?.zoom))],
    },
    {
      name: 'Screen',
      options: [onSheet('oled', 'OLED screen', (it) => it.specs?.sheet?.pan === 'OLED'), onSheet('hz', 'Smooth (90Hz+)', (it) => (it.specs?.sheet?.hz ?? 0) >= 90)],
    },
    // These read the model's spec sheet, so a phone without one is left out rather than guessed at.
    {
      name: 'Features',
      quick: ['g5'],
      options: [
        onSheet('g5', '5G', (it) => Boolean(it.specs?.sheet?.g5)),
        onSheet('ip', 'Water resistant', (it) => waterTight(it.specs?.sheet)),
        onSheet('sd', 'Memory card slot', (it) => Boolean(it.specs?.sheet?.sd)),
        onSheet('jack', 'Headphone socket', (it) => Boolean(it.specs?.sheet?.jack)),
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
/**
 * Share of the phones and tablets on screen that have a full spec sheet. Filters that read the
 * sheet are held back until this is high: "5G" that silently leaves out every phone without a
 * sheet would look like an answer and be wrong.
 */
function sheetCover(): number {
  const mobile = items.filter((it) => it.kind === 'phone' || it.kind === 'tablet');
  return mobile.length ? mobile.filter((it) => it.specs?.sheet).length / mobile.length : 0;
}

const facetGroups = (): FacetGroup[] => {
  const s = shelf();
  if (!s) return [];
  const all = FACETS[s];
  if (!all.some((g) => g.options.some((o) => o.sheet)) || sheetCover() >= 0.85) return all;
  // Keep any already switched on, so a saved link still shows what it is filtering by.
  const keep = (o: Facet): boolean => !o.sheet || F.fx.includes(o.id);
  return all
    .map((g) => ({ ...g, options: g.options.filter(keep), quick: g.quick?.filter((id) => g.options.some((o) => o.id === id && keep(o))) }))
    .filter((g) => g.options.length);
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
    mode: ['up', 'fit', 'add', 'in', 'sold'].includes(p.get('m') ?? '') ? p.get('m') : '',
    ac: p.get('ac') ?? '',
    pick: p.get('id') ?? '',
    bud: Number(p.get('bud')) || 0,
    ft: FIT_TYPES.includes(p.get('ft') as FitType) ? p.get('ft') : 'phone',
    need: p.has('need') ? (p.get('need') ?? '') : 'u',
    fo: FOCI.some(([id]) => id === p.get('fo')) ? p.get('fo') : '',
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
    if (F.fo) p.set('fo', F.fo);
    if (F.ac) p.set('ac', F.ac);
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
/** Cases standing on a shelf, spines out. */
const ICON_SPINE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 4h4v16h-4zM8.5 4h4v16h-4zM14.4 6.2l3.7-1 3.4 13.6-3.7 1z"/></svg>';

const isFilm = (it: Item): boolean => it.superCat === 'Film & TV';

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

/** The curve iOS uses for sheets and pushes: quick off the mark, a long settle. */
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const calm = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Where the selection thumb last sat in the category strip, so it can slide from there. */
let thumbAt: { x: number; w: number } | null = null;

/** Draw the thumb behind the chosen category. The strip is redrawn each time, so the slide starts from where it was before. */
function placeThumb(on: HTMLElement | null): void {
  if (!on || $('#presets').hidden) return void (thumbAt = on ? thumbAt : null);
  const to = { x: on.offsetLeft, w: on.offsetWidth };
  const thumb = document.createElement('i');
  thumb.className = 'seg-thumb';
  thumb.style.left = `${to.x}px`;
  thumb.style.width = `${to.w}px`;
  $('#presets').prepend(thumb);
  if (thumbAt && to.w && (thumbAt.x !== to.x || thumbAt.w !== to.w) && !calm()) {
    thumb.animate([{ transform: `translateX(${thumbAt.x - to.x}px) scaleX(${thumbAt.w / to.w})` }, { transform: 'none' }], { duration: 380, easing: EASE });
  }
  if (to.w) thumbAt = to;
}

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
  placeThumb(on);
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
  // Mention a shortcut a few times, until it has been used. One tip per visit: the scanner first,
  // as it moved off the bar and is the one most likely to be missed.
  const tip = $('#holdTip');
  if (tip.hidden && !tipShown) {
    const findSeen = store.get('findTipSeen', 0);
    const seen = store.get('holdTipSeen', 0);
    const showTip = (text: string, mid: boolean, key: string, n: number): void => {
      tipShown = true;
      tip.textContent = text;
      tip.classList.toggle('mid', mid);
      tip.hidden = false;
      store.set(key, n + 1);
      window.setTimeout(() => (tip.hidden = true), 6000);
    };
    if (findSeen < 3 && !store.get('findHoldUsed', false)) showTip('Tip: hold Search to scan a barcode.', true, 'findTipSeen', findSeen);
    else if (!plain && seen < 4 && !store.get('holdUsed', false)) showTip('Tip: hold Filters and slide up. Slide left for more.', false, 'holdTipSeen', seen);
  }
}

function renderStatus(): void {
  const el = $('#status');
  if (loading) el.textContent = 'Searching…';
  else if (error) el.textContent = 'Offline';
  else if (F.mode || isHome()) el.textContent = demo ? 'Demo data' : 'In-stock only';
  else el.textContent = `${total.toLocaleString('en-GB')} in stock${demo ? ' · demo' : ''}`;
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

/** `when` puts a time under the price; `plain` leaves off the extras (the spine button). */
function cardHtml(g: Group, note = '', opts: { cls?: string; tag?: string; vt?: string; when?: string; plain?: boolean } = {}): string {
  const it = g.head;
  const n = g.items.length;
  const grades = [...new Set(g.items.map((i) => i.grade).filter(Boolean))].sort();
  const gradeTxt = grades.length ? `Grade ${grades.join(', ')}` : '';
  const meta = n > 1 ? [`${n} in stock`, gradeTxt].filter(Boolean).join(' · ') : [it.variant, gradeTxt].filter(Boolean).join(' · ');
  const icon = it.kind === 'phone' || it.kind === 'tablet' ? ICON_PHONE : it.kind === 'other' ? ICON_BOX : ICON_LAPTOP;
  const img = it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" decoding="async" width="64" height="64" onerror="this.remove()">` : '';
  const price = g.max > g.min ? `<small>from</small>${money(g.min)}` : money(g.min);
  const tag = opts.tag ? `<span class="badge tag">${esc(opts.tag)}</span>` : '';
  // Films get a way to see the spine, unless an earlier look found no scan of it.
  const spine = !opts.plain && isFilm(it) && !demo && remembered(it.id) !== null;
  return `<li class="card${opts.cls ?? ''}${spine ? ' has-spine' : ''}" data-key="${esc(g.key)}"${opts.vt ? ` style="view-transition-name:${opts.vt}"` : ''}>
    <button type="button" class="card-main" data-act="toggle" aria-expanded="false">
      <span class="thumb">${icon}${img}</span>
      <span class="body">
        <span class="title">${esc(it.title)}</span>
        <span class="sub">${esc(it.sub)}</span>
        ${meta ? `<span class="meta">${esc(meta)}</span>` : ''}
        ${note ? `<span class="meta">${esc(note)}</span>` : ''}
        <span class="badges">${tag}${supportBadge(it)}${perfBadge(it)}</span>
      </span>
      <span class="price">${price}${opts.when ? `<span class="when">${esc(opts.when)}</span>` : ''}</span>
    </button>
    ${spine ? `<button type="button" class="spine-btn" data-act="cover" data-v="${esc(it.id)}" aria-label="Show the spine and cover of ${esc(it.title)}">${ICON_SPINE}<span>Spine</span></button>` : ''}
  </li>`;
}

// ------------------------------------------------------------------ film covers
//
// A shelf of films shows only spines, and CeX's picture is the front. This opens a scan of the
// whole sleeve, centred on the spine, so there is a colour and a title style to look for.

let coverTurn = 0;

function findItem(id: string): Item | null {
  for (const g of [...groups, ...scanGroups.values()]) for (const i of g.items) if (i.id === id) return i;
  return null;
}

const isBluray = (it: Item): boolean => /blu-?ray|4k|uhd/i.test(it.category);

/** One line on which edition the scan is, and how far to trust its spine. */
/** Which edition the scan is ("US DVD"), and how far to trust its spine, in a few words. */
function edition(c: Cover, it: Item): { tag: string; note: string } {
  const tag = [c.region, c.bluray ? 'Blu-ray' : 'DVD'].filter(Boolean).join(' ');
  if (c.bluray !== isBluray(it)) return { tag, note: `No ${isBluray(it) ? 'Blu-ray' : 'DVD'} scan, so the spine will look different` };
  return { tag, note: c.region === 'UK' ? '' : 'The UK spine can differ a little' };
}

let toastTimer = 0;

/** A line of news that needs no answer, shown briefly above the bottom bar. */
function toast(text: string): void {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  // As a popover it sits in the top layer, so it shows over the scanner too.
  try {
    if (el.matches(':popover-open')) el.hidePopover();
    el.showPopover();
  } catch {
    /* no popover support: it shows in place */
  }
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    try {
      el.hidePopover();
    } catch {
      /* was never a popover */
    }
    el.hidden = true;
  }, 2800);
}

function showCover(it: Item, c: Cover): void {
  const d = $<HTMLDialogElement>('#cover');
  const s = spineOf(c);
  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`;
  const ed = edition(c, it);
  // A sheet: pulled down (or the dimmed page above it tapped) puts it away, so it needs no close
  // button; the one here is for screen readers only.
  d.innerHTML = `<span class="grabber" aria-hidden="true"></span>
    <header class="cover-top">
      <h2>${esc(it.title)}</h2>
      <p><span class="ed">${esc(ed.tag)}</span>${ed.note ? `<span>${esc(ed.note)}</span>` : ''}<a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer" aria-label="Scan from dvdcover.com, opens in a new tab">dvdcover.com</a></p>
    </header>
    <div class="cover-stage" id="coverStage">
      <div class="cover-flat" style="aspect-ratio:${c.w}/${c.h}">
        <img src="${esc(c.src)}" width="${c.w}" height="${c.h}" referrerpolicy="no-referrer" alt="Back, spine and front of the ${esc(it.title)} sleeve">
        <span class="cover-mark" style="left:${pct(s.left)};width:${pct(s.width)}"></span>
        <i class="snap" data-at="back"></i><i class="snap" data-at="spine" style="left:${pct(0.5)}"></i><i class="snap" data-at="front"></i>
      </div>
    </div>
    <footer class="cover-foot">
      <div class="seg" role="group" aria-label="Part of the cover">
        <button type="button" data-act="cover-part" data-v="back" aria-pressed="false">Back</button>
        <button type="button" data-act="cover-part" data-v="spine" aria-pressed="true">Spine</button>
        <button type="button" data-act="cover-part" data-v="front" aria-pressed="false">Front</button>
      </div>
      <button type="button" class="sr" data-act="cover-close">Close</button>
    </footer>`;
  const stage = $('#coverStage');
  const img = stage.querySelector('img')!;
  // The archive withdrew or moved the image: close, say so, and look it up afresh next time.
  img.addEventListener('error', () => {
    forget(it.id);
    if (!d.open) return;
    if (history.state?.ui) history.back();
    else d.close();
    toast("That scan wouldn't load.");
  });
  const mark = (): void => {
    const max = stage.scrollWidth - stage.clientWidth;
    // Wide enough to show the whole sleeve at once: nothing to move between.
    d.classList.toggle('fits', max <= 4);
    if (stage.dataset.gliding) return;
    showPart(max <= 4 ? 'spine' : stage.scrollLeft < max * 0.25 ? 'back' : stage.scrollLeft > max * 0.75 ? 'front' : 'spine');
  };
  stage.addEventListener('scroll', mark, { passive: true });
  coverTo('spine', false);
  mark();
}

let coverGlide = 0;

const PARTS = ['back', 'spine', 'front'];

/**
 * Mark which part of the sleeve is in view: the selector's thumb slides to it, and on the spine
 * the back and front dim, so the strip to look for on the shelf is the one thing lit.
 */
function showPart(part: string): void {
  const d = $<HTMLDialogElement>('#cover');
  d.dataset.part = part;
  d.querySelector<HTMLElement>('.seg')?.style.setProperty('--at', String(Math.max(0, PARTS.indexOf(part))));
  for (const b of d.querySelectorAll<HTMLElement>('[data-act="cover-part"]')) b.setAttribute('aria-pressed', String(b.dataset.v === part));
}

/** Bring one part of the sleeve to the middle of the screen. */
function coverTo(part: string, smooth = true): void {
  const stage = document.querySelector<HTMLElement>('#coverStage');
  if (!stage) return;
  const max = stage.scrollWidth - stage.clientWidth;
  const left = part === 'back' ? 0 : part === 'front' ? max : max / 2;
  // Answer the tap at once; the scroll listener keeps it right when the sleeve is dragged instead.
  showPart(part);
  // While it glides there, the parts it passes on the way must not light up.
  window.clearTimeout(coverGlide);
  stage.dataset.gliding = '1';
  coverGlide = window.setTimeout(() => delete stage.dataset.gliding, 700);
  stage.scrollTo({ left, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
}

/** Films being looked up right now, so a second tap does not ask twice. */
const coverLooking = new Set<string>();

/**
 * The viewer only opens once there is a scan to show. While the archive is asked, the button
 * itself shows the wait; no scan, or no connection, is a line of text and nothing more.
 */
async function openCover(it: Item, btn: HTMLElement | null): Promise<void> {
  if (coverLooking.has(it.id)) return;
  const turn = ++coverTurn;
  const from = location.hash;
  let c = remembered(it.id);
  if (c === undefined) {
    coverLooking.add(it.id);
    btn?.setAttribute('aria-busy', 'true');
    try {
      c = await findCover({ id: it.id, name: it.name, year: it.year, bluray: isBluray(it) });
    } catch {
      toast("Couldn't reach the cover archive. Try again.");
      return;
    } finally {
      coverLooking.delete(it.id);
      // The list may have been redrawn while waiting, so clear whichever button is there now.
      for (const b of document.querySelectorAll(`.spine-btn[data-v="${CSS.escape(it.id)}"]`)) b.removeAttribute('aria-busy');
    }
  }
  if (!c) {
    // Nothing to show next time either, so the card stops offering it.
    for (const b of document.querySelectorAll<HTMLElement>(`.spine-btn[data-v="${CSS.escape(it.id)}"]`)) {
      b.closest('.card')?.classList.remove('has-spine');
      b.remove();
    }
    toast('No spine scan found for this one.');
    return;
  }
  // Moved on to something else while it was looking: the answer is kept, but nothing pops up.
  if (turn !== coverTurn || location.hash !== from) return;
  const d = $<HTMLDialogElement>('#cover');
  if (!d.open) {
    d.classList.remove('fits');
    d.innerHTML = '';
    d.showModal();
    history.pushState({ ui: true }, '');
  }
  // Drawn once the viewer is open, so it can be measured and centred on the spine.
  showCover(it, c);
}

const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The model's spec sheet in plain words. Only what is recorded: a missing fact is a missing row. */
function specRows(it: Item): [string, string][] {
  const s = it.specs;
  if (!s) return [];
  const sh = s.sheet;
  const join = (parts: (string | false | 0 | undefined)[]): string => parts.filter(Boolean).join(' · ');
  const rows: [string, string][] = [];
  const size = it.screen || s.screen;
  if (size) rows.push(['Screen', join([`${size}″`, sh?.pan, sh?.hz && `${sh.hz}Hz`])]);
  if (s.mah) rows.push(['Battery', join([`${s.mah.toLocaleString('en-GB')} mAh when new`, sh?.w && `${sh.w}W charging`, sh?.wl !== undefined && 'wireless charging'])]);
  if (s.mp) rows.push(['Camera', join([cameraText(s), sh?.sf && `${sh.sf}MP selfie`])]);
  if (sh) {
    const ram = it.ramGb ? `${it.ramGb}GB memory` : sh.ram?.length ? `${sh.ram.length > 1 ? `${sh.ram[0]} to ${sh.ram[sh.ram.length - 1]}` : sh.ram[0]}GB memory` : '';
    if (sh.chip) rows.push(['Chip', join([sh.chip, ram])]);
    // A Wi-Fi tablet has no mobile network to speak of.
    if (it.kind === 'phone') rows.push(['Network', sh.g5 ? '5G' : '4G, no 5G']);
    const extras = join([
      sh.ip && `${sh.ip} ${waterTight(sh) ? 'water resistant' : 'splash resistant'}`,
      sh.sd && 'memory card slot',
      sh.jack && 'headphone socket',
      sh.nfc && 'contactless (NFC)',
      sh.usbc && 'USB-C',
    ]);
    if (extras) rows.push(['Extras', extras]);
  }
  // The month and year only: what it came with is the update badge's business.
  if (s.year) rows.push(['Released', `${sh?.m ? `${MONTH[sh.m - 1]} ` : ''}${s.year}`]);
  return rows;
}

const DAY = 864e5;
const daysAgo = (t: number): string => {
  const d = Math.floor((Date.now() - t) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
};
const cexPage = (v: Item): string => (demo ? `https://uk.webuy.com/search?stext=${encodeURIComponent(v.name)}` : `https://uk.webuy.com/product-detail?id=${encodeURIComponent(v.id)}`);
const ICON_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const ICON_OUT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16 16 8M9.5 8H16v6.5"/></svg>';
const DOT = '<i class="dot" aria-hidden="true"></i>';

/**
 * An opened card says only what the card itself doesn't:
 *  - update status only when it needs explaining (ending, ended, unknown); otherwise the badge says it;
 *  - the price only when it has just changed, so the label may need reprinting, or for a scanned
 *    label, what it should read;
 *  - the spec sheet, naming the chip once; how fast it is is the badge's job;
 *  - a list of copies only when there is more than one to choose from;
 *  - what to do next: add-ons, and CeX's own page.
 */
function detailHtml(g: Group): string {
  const it = g.head;
  const one = g.items.length === 1;
  const scanned = g.key.startsWith('scan:');
  const facts: string[] = [];
  const fact = (k: string, html: string, cls = ''): void => void facts.push(`<dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}>${html}</dd>`);

  const s = it.support;
  if (s.status === 'warn' || s.status === 'ended' || s.status === 'unknown' || s.stale) {
    fact(it.kind === 'laptop' || it.kind === 'desktop' ? 'System' : 'Updates', DOT + esc(s.detail), `st-${s.status}`);
  }
  const fresh = it.priceChanged > 0 && Date.now() - it.priceChanged < 14 * DAY;
  if (scanned) fact('Label', `${fresh ? DOT : ''}Should read ${money(it.price)}${fresh ? `. Changed ${daysAgo(it.priceChanged)}` : ''}`, fresh ? 'st-warn' : '');
  else if (fresh) fact('Price', `${DOT}Changed ${daysAgo(it.priceChanged)}. Check the label matches.`, 'st-warn');
  for (const [k, v] of specRows(it)) fact(k, esc(v));

  const sh = it.specs?.sheet;
  // Naming the sheet's own device makes a wrong match visible at a glance.
  const source = sh && specRows(it).length ? `<p class="specs-src">Specs from <a href="https://www.gsmarena.com/x-${sh.id}.php" target="_blank" rel="noopener noreferrer">GSMArena’s ${esc(sh.n)} page</a></p>` : '';

  // Several copies: which colour or grade at which price. Each opens its own CeX page.
  const copies = one
    ? ''
    : `<ul class="variants">${g.items
        .map((v) => {
          const label = v.variant || (v.grade ? `Grade ${v.grade}` : v.name);
          return `<li><a href="${cexPage(v)}" target="_blank" rel="noopener">
        <span class="v-name">${esc(label)}</span>
        ${v.variant && v.grade ? `<span class="grade g${v.grade}">${v.grade}</span>` : ''}
        <span class="v-price">${money(v.price)}</span>${ICON_CHEVRON}
      </a></li>`;
        })
        .join('')}</ul>`;

  // One filled action at most: a step up for a scanned phone, otherwise add-ons.
  const acts: string[] = [];
  const stepUp = scanned && (it.kind === 'phone' || it.kind === 'tablet');
  if (stepUp) acts.push(`<button type="button" class="chip" aria-pressed="true" data-act="stepup" data-v="${esc(it.id)}">Find a step up</button>`);
  if (!demo && slotsFor(it).length) acts.push(`<button type="button" class="chip" aria-pressed="${!stepUp}" data-act="addons" data-v="${esc(it.id)}">Suggest add-ons</button>`);
  if (scanned && (it.model || it.title)) acts.push(`<button type="button" class="chip" aria-pressed="false" data-act="similar" data-v="${esc(it.model || it.title)}">Find similar</button>`);
  if (one) acts.push(`<a class="chip out" href="${cexPage(it)}" target="_blank" rel="noopener">CeX page${ICON_OUT}</a>`);

  const list = facts.length ? `<dl class="specs">${facts.join('')}</dl>${source}` : '';
  return `<div class="detail">${list}${copies}${acts.length ? `<div class="detail-acts">${acts.join('')}</div>` : ''}</div>`;
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
    void fillActivity(flowHost, main);
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
      <header class="sheet-bar"><h2>${plain ? 'Settings' : 'Filters'}</h2><button class="done" value="close">Done</button></header>
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
/** Where the add-ons screen was opened from in this visit (null when it was opened from a saved link). */
let addonsFrom: string | null = null;

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
  toItem: (h) => toItem(h, 0, ctx),
  sampleHits: () => sampleStock(branch),
  branch: () => branch,
  limit: () => stepLimit,
  recent: () => store.get<string[]>('recent', []),
  categories: () => PRESETS.map((p) => [p.id, p.label]),
  item: (id) => findItem(id) ?? undefined,
  async lookup(id) {
    const { hits: found } = await lookupIds([id], branch);
    return found[0] ? toItem(found[0], 0, ctx) : null;
  },
  async addonStock(cats, ranked) {
    // Each list keeps CeX's popularity order in `idx`, which is how the most popular pick is found.
    return (await addonStock(branch, cats, ranked)).map((list) => list.map((h, i) => toItem(h, i, ctx)));
  },
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

/** One row of the quick-filter panel. */
interface HoldEntry {
  label: string;
  meta?: string;
  on: boolean;
  /** What letting go here (or tapping it) does. */
  run?: () => void;
  /** Menu key (see menuFor) of the choices this row opens in a column to its left. */
  sub?: string;
  quiet?: boolean;
  disabled?: boolean;
  /** Shown in place of the tick, for rows that are actions rather than choices. */
  icon?: string;
}

/** Do exactly what tapping the matching chip would. */
function act(a: string, v: string): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.hidden = true;
  b.dataset.act = a;
  b.dataset.v = v;
  document.body.append(b);
  b.click();
  b.remove();
}

function toggleEntry(label: string, a: string, v: string, on: boolean): HoldEntry {
  const n = countFor({ label, act: a, v, on });
  return { label, on, meta: n === null ? undefined : n.toLocaleString('en-GB'), disabled: n === 0 && !on, run: () => act(a, v) };
}

/**
 * The main column. Single choices are plain toggles; anything with several values (Android
 * brand, price, speed, platform) is one row that opens a column of its values to the left.
 * Listed most used first, which puts them nearest the thumb.
 */
function holdEntries(): HoldEntry[] {
  const sh = shelf();
  const out: HoldEntry[] = [];
  if (isMobile(sh)) out.push(toggleEntry('Still updated', 'up', '1', F.up === 1));
  for (const g of facetGroups()) {
    const quick = g.options.filter((o) => g.quick?.includes(o.id));
    if (!quick.length) continue;
    if (g.name === 'System') {
      for (const o of quick) {
        if (o.id === 'and' || o.id === 'andt') {
          const on = F.fx.includes(o.id);
          const label = on && F.brands.length === 1 ? F.brands[0] : o.label;
          out.push({ ...toggleEntry(label, 'fx', o.id, on), meta: undefined, sub: `brand:${o.id}` });
        } else out.push(toggleEntry(o.label, 'fx', o.id, F.fx.includes(o.id)));
      }
    } else if (quick.length > 2) {
      const chosen = g.options.find((o) => F.fx.includes(o.id));
      out.push({ label: chosen ? chosen.label : g.name, on: Boolean(chosen), sub: `group:${g.name}` });
    } else for (const o of quick) out.push(toggleEntry(o.label, 'fx', o.id, F.fx.includes(o.id)));
  }
  const speedName: Record<number, string> = { 3: 'Good or faster', 4: 'Fast or faster', 5: 'Top speed' };
  if (isDevice(sh)) out.push({ label: speedName[F.perf] ?? 'Speed', on: F.perf > 0, sub: 'speed' });
  out.push({ label: F.max ? `Under £${F.max}` : 'Price', on: F.max > 0, sub: 'price' });
  return out;
}

const holdEl = $('#hold');
const filtersBtn = $<HTMLButtonElement>('#dockFilters');
const searchBtn = $<HTMLButtonElement>('#dockSearch');
/** The dock button the current hold started on: Filters (quick filters) or Search (find). */
let holdBtn: HTMLButtonElement = filtersBtn;
let holdTimer = 0;
let dwellTimer = 0;
let holding = false;
let holdMoved = false;
let holdStart = { x: 0, y: 0 };
/** The finger that started the hold; any other pointer (a second finger, a mouse) is ignored. */
let holdPointer = -1;
let hot: HTMLElement | null = null;
/** The tap that ends a hold must not also open the sheet. */
let swallowTap = false;
const entries = new WeakMap<HTMLElement, HoldEntry>();
let mainPanel: HTMLElement | null = null;
let subPanel: HTMLElement | null = null;
let subParent: HTMLElement | null = null;
/** Width of the main column while a side column is open. */
const SPLIT_W = 152;

const ICON_TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_MORE = '<svg class="more" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

const rowHtml = (e: HoldEntry, i: number): string =>
  `<button type="button" class="hold-row${e.quiet ? ' quiet' : ''}" data-i="${i}" role="menuitem"${e.disabled ? ' disabled' : ''} aria-pressed="${e.on}"${e.sub ? ' aria-haspopup="menu"' : ''}>` +
  `<span class="hold-tick">${e.icon ?? (e.quiet ? ICON_X : e.on ? ICON_TICK : '')}</span><span class="hold-label">${esc(e.label)}</span>` +
  `${e.meta ? `<span class="hold-n">${esc(e.meta)}</span>` : ''}${e.sub ? ICON_MORE : ''}</button>`;

function bindRows(panel: HTMLElement, list: HoldEntry[]): void {
  for (const el of panel.querySelectorAll<HTMLElement>('.hold-row')) entries.set(el, list[Number(el.dataset.i)]);
}

const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const ICON_SCAN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/></svg>';

function focusSearch(): void {
  document.body.classList.remove('tuck');
  const box = $<HTMLInputElement>('#q');
  box.focus();
  box.select();
}

/**
 * Holding Search: the ways to find something. Search sits nearest the thumb, Scan one row up,
 * so a hold and a short slide up opens the camera.
 */
function openFind(): void {
  const list: HoldEntry[] = [
    { label: 'Search stock', on: false, icon: ICON_SEARCH, run: focusSearch },
    { label: 'Scan a barcode', on: false, icon: ICON_SCAN, run: () => void openScan() },
  ].reverse();
  // Centred over the Search button, kept on screen.
  const b = searchBtn.getBoundingClientRect();
  const dock = $('.dock').getBoundingClientRect();
  const width = Math.min(250, window.innerWidth - 24);
  const left = Math.max(12, Math.min(b.left + b.width / 2 - width / 2, window.innerWidth - 12 - width));
  holdEl.innerHTML = `<div class="hold-panel hold-main hold-find" role="menu" aria-label="Find" style="left:${Math.round(left)}px;width:${Math.round(width)}px;bottom:${Math.round(window.innerHeight - dock.top + 10)}px">
    <p class="hold-head"><span>Find</span></p>
    ${list.map(rowHtml).join('')}
  </div>`;
  mainPanel = holdEl.querySelector<HTMLElement>('.hold-main');
  if (mainPanel) bindRows(mainPanel, list);
  holdEl.hidden = false;
  document.body.classList.add('holding');
  store.set('findHoldUsed', true);
  $('#holdTip').hidden = true;
}

function openHold(): void {
  if (holdBtn === searchBtn) return openFind();
  const list = holdEntries().reverse();
  const reset: HoldEntry | null = activeCount() ? { label: 'Clear all filters', on: false, quiet: true, run: () => act('reset', '') } : null;
  const all = reset ? [reset, ...list] : list;
  const dock = $('.dock').getBoundingClientRect();
  const where = PRESETS.find((p) => p.id === F.preset)?.label ?? (F.q ? `“${F.q}”` : 'Results');
  holdEl.innerHTML = `<div class="hold-panel hold-main" role="menu" aria-label="Quick filters" style="right:${Math.round(window.innerWidth - dock.right)}px;bottom:${Math.round(window.innerHeight - dock.top + 10)}px">
    <p class="hold-head"><span>Quick filters</span><span>${esc(where)}</span></p>
    ${all.map((e, i) => rowHtml(e, i) + (e === reset ? '<hr class="hold-sep">' : '')).join('')}
  </div>`;
  mainPanel = holdEl.querySelector<HTMLElement>('.hold-main');
  if (mainPanel) bindRows(mainPanel, all);
  holdEl.hidden = false;
  document.body.classList.add('holding');
  store.set('holdUsed', true);
  $('#holdTip').hidden = true;
}

/** Open the column of choices behind a main row, to its left and level with it. */
function openSub(parent: HTMLElement): void {
  const e = entries.get(parent);
  if (!e?.sub || !mainPanel || subParent === parent) return;
  closeSub();
  const m = menuFor(e.sub);
  if (!m) return;
  // Reversed so the first choice ("Any …") sits level with the row it came from and the most
  // likely ones stack just above it.
  const rows = m.list
    .filter((i) => !i.sep)
    .map((i): HoldEntry => ({ label: i.label, meta: i.meta, on: Boolean(i.on), quiet: i.quiet, disabled: i.meta === '0' && !i.on, run: () => m.pick(i.v) }))
    .reverse();
  mainPanel.classList.add('split');
  parent.classList.add('open');
  const mainLeft = window.innerWidth - parseFloat(mainPanel.style.right) - SPLIT_W;
  const width = Math.min(250, mainLeft - 8 - 12);
  const el = document.createElement('div');
  el.className = 'hold-panel hold-sub';
  el.setAttribute('role', 'menu');
  el.setAttribute('aria-label', m.title);
  el.innerHTML = `<p class="hold-head"><span>${esc(m.title)}</span></p>${rows.map(rowHtml).join('')}`;
  el.style.width = `${Math.round(width)}px`;
  el.style.left = `${Math.round(mainLeft - 8 - width)}px`;
  el.style.bottom = `${Math.round(window.innerHeight - parent.getBoundingClientRect().bottom - 6)}px`;
  holdEl.append(el);
  if (el.getBoundingClientRect().top < 12) {
    el.style.bottom = 'auto';
    el.style.top = '12px';
  }
  bindRows(el, rows);
  subPanel = el;
  subParent = parent;
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
}

function closeSub(): void {
  window.clearTimeout(dwellTimer);
  window.clearTimeout(switchTimer);
  pendingRow = null;
  subPanel?.remove();
  subPanel = null;
  subParent?.classList.remove('open');
  subParent = null;
  mainPanel?.classList.remove('split');
}

function closeHold(): void {
  closeSub();
  trail = [];
  holdEl.hidden = true;
  holdEl.innerHTML = '';
  document.body.classList.remove('holding');
  holdBtn.classList.remove('anchor');
  mainPanel = null;
  hot = null;
}

function setHot(el: HTMLElement | null): void {
  if (el === hot) return;
  hot?.classList.remove('hot');
  hot = el;
  hot?.classList.add('hot');
  window.clearTimeout(dwellTimer);
  // Resting on a row with more behind it opens its column, so a slow, careful thumb gets there too.
  if (hot && hot !== subParent && mainPanel?.contains(hot) && entries.get(hot)?.sub) {
    const row = hot;
    dwellTimer = window.setTimeout(() => {
      if (hot === row) openSub(row);
    }, 320);
  }
  if (hot && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(8);
}

/** The enabled row nearest a height, if the finger is close enough to mean it. */
function nearestRow(panel: HTMLElement, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestGap = Infinity;
  for (const el of panel.querySelectorAll<HTMLElement>('.hold-row:not(:disabled)')) {
    const b = el.getBoundingClientRect();
    const gap = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    if (gap < bestGap) {
      best = el;
      bestGap = gap;
    }
  }
  return bestGap <= 18 ? best : null;
}

/** Open the panel now, holding on to the finger so a slide keeps reporting here. */
function startHold(pointerId: number): void {
  window.clearTimeout(holdTimer);
  if (holding) return;
  holding = true;
  openHold();
  holdBtn.classList.add('anchor');
  try {
    holdBtn.setPointerCapture(pointerId);
  } catch {
    /* the finger has already lifted */
  }
  if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(15);
}

function beginPress(btn: HTMLButtonElement, ev: PointerEvent): void {
  if (holding || !holdEl.hidden) return;
  holdBtn = btn;
  holdPointer = ev.pointerId;
  holdStart = { x: ev.clientX, y: ev.clientY };
  holdMoved = false;
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => startHold(ev.pointerId), 200);
}

filtersBtn.addEventListener('pointerdown', (ev) => {
  // On the start screen and in the sales flows this button is Settings, with nothing to hold.
  if (isHome() || F.mode) return;
  beginPress(filtersBtn, ev);
});
// Search works everywhere, so holding it for the scanner does too.
searchBtn.addEventListener('pointerdown', (ev) => beginPress(searchBtn, ev));

// ---- reading intent, not just position
//
// A thumb heading for the side column rarely travels straight: it drifts over the rows above or
// below on the way. Three rules keep the panel on what was meant:
//   1. Rows are sticky: the current row holds until the finger is clearly inside another.
//   2. Moving mostly leftward from a row that has a column is heading for that column, whatever
//      rows the finger brushes on the way.
//   3. With a column open, any move that stays inside the triangle from the finger to the
//      column's near edge is still on its way there. Only a pause off the path, or a move away
//      from the column, switches rows.

/** Recent finger positions, newest last, for working out the direction of travel. */
let trail: { x: number; y: number; t: number }[] = [];
let switchTimer = 0;
let pendingRow: HTMLElement | null = null;
let lastPoint = { x: 0, y: 0 };

function track(x: number, y: number): void {
  const t = performance.now();
  trail.push({ x, y, t });
  while (trail.length > 2 && t - trail[0].t > 90) trail.shift();
  lastPoint = { x, y };
}

/** Direction over roughly the last tenth of a second. */
function heading(): { dx: number; dy: number } {
  if (trail.length < 2) return { dx: 0, dy: 0 };
  const a = trail[0];
  const b = trail[trail.length - 1];
  return { dx: b.x - a.x, dy: b.y - a.y };
}

const headingLeft = (): boolean => {
  const h = heading();
  return h.dx < -3 && -h.dx > Math.abs(h.dy) * 0.9;
};

/** Is the finger still travelling inside the cone towards the open column? */
function towardsColumn(x: number, y: number): boolean {
  if (!subPanel || trail.length < 2) return false;
  const s = subPanel.getBoundingClientRect();
  const p = trail[0];
  // Triangle from where the finger was a moment ago to the column's near (right) edge, padded.
  const ax = p.x;
  const ay = p.y;
  const bx = s.right + 6;
  const by = s.top - 24;
  const cx = s.right + 6;
  const cy = s.bottom + 24;
  const side = (x1: number, y1: number, x2: number, y2: number): number => (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2);
  const d1 = side(ax, ay, bx, by);
  const d2 = side(bx, by, cx, cy);
  const d3 = side(cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos) && x <= p.x + 2;
}

/** Row under the finger, holding on to `keep` until the finger is clearly past its edge. */
function stickyRow(panel: HTMLElement, y: number, keep: HTMLElement | null): HTMLElement | null {
  if (keep && panel.contains(keep)) {
    const b = keep.getBoundingClientRect();
    if (y >= b.top - 12 && y <= b.bottom + 12) return keep;
  }
  return nearestRow(panel, y);
}

function cancelSwitch(): void {
  window.clearTimeout(switchTimer);
  pendingRow = null;
}

function onHoldMove(ev: PointerEvent): void {
  if (ev.pointerId !== holdPointer) return;
  const x = ev.clientX;
  const y = ev.clientY;
  const dx = x - holdStart.x;
  const dy = y - holdStart.y;
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
  track(x, y);
  if (far > 16) holdMoved = true;
  if (!mainPanel || !holdMoved) return setHot(null);
  const box = mainPanel.getBoundingClientRect();

  if (subPanel) {
    const inColumn = hot !== null && subPanel.contains(hot);
    // Once in the column, the finger has to come well back over the main list to leave it.
    if (x < box.left + (inColumn ? 18 : -2)) {
      cancelSwitch();
      const sb = subPanel.getBoundingClientRect();
      return setHot(y >= sb.top - 30 && y <= sb.bottom + 30 ? stickyRow(subPanel, y, inColumn ? hot : null) : null);
    }
    const row = stickyRow(mainPanel, y, subParent);
    if (row === subParent || row === null) {
      cancelSwitch();
      return setHot(subParent);
    }
    // Over a different main row. On the way to the column: stay put. Otherwise switch only
    // once the finger has settled there.
    if (headingLeft() || towardsColumn(x, y)) {
      cancelSwitch();
      return setHot(subParent);
    }
    if (pendingRow !== row) {
      cancelSwitch();
      pendingRow = row;
      switchTimer = window.setTimeout(() => {
        if (!subPanel || !mainPanel || pendingRow !== row) return;
        if (stickyRow(mainPanel, lastPoint.y, null) !== row || lastPoint.x < mainPanel.getBoundingClientRect().left) return;
        closeSub();
        pendingRow = null;
        setHot(row);
      }, 160);
    }
    return;
  }

  // No column yet. Heading left from a row that has one means that row, even if the finger
  // drifts over a neighbour on the way.
  const fromRow = hot && mainPanel.contains(hot) && entries.get(hot)?.sub ? hot : null;
  if (fromRow && headingLeft()) {
    if (x < box.left + 24) openSub(fromRow);
    return;
  }
  if (x < box.left - 40 || x > box.right + 40 || y < box.top - 20) return setHot(null);
  setHot(stickyRow(mainPanel, y, hot && mainPanel.contains(hot) ? hot : null));
}

const endHold = (cancelled: boolean): void => {
  window.clearTimeout(holdTimer);
  window.clearTimeout(dwellTimer);
  window.clearTimeout(switchTimer);
  if (!holding) return;
  holding = false;
  swallowTap = true;
  window.setTimeout(() => (swallowTap = false), 400);
  if (cancelled) return closeHold();
  const chosen = hot ? entries.get(hot) : undefined;
  if (chosen?.run) {
    closeHold();
    chosen.run();
    return;
  }
  if (hot && chosen?.sub) {
    // Let go on a row that only opens more: show its column and leave both up to be tapped.
    const row = hot;
    setHot(null);
    openSub(row);
    return;
  }
  if (holdMoved) closeHold();
  // Held without sliding: the panel stays up to be tapped.
};
for (const btn of [filtersBtn, searchBtn]) {
  btn.addEventListener('pointermove', onHoldMove);
  btn.addEventListener('pointerup', (ev) => ev.pointerId === holdPointer && endHold(false));
  btn.addEventListener('pointercancel', (ev) => ev.pointerId === holdPointer && endHold(true));
  btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
}

// Tapping, once the panel is up: rows with more open their column, everything else applies.
holdEl.addEventListener('click', (ev) => {
  const row = (ev.target as HTMLElement).closest<HTMLElement>('.hold-row');
  if (!row) {
    if (ev.target === holdEl) closeHold();
    return;
  }
  ev.stopPropagation();
  const e = entries.get(row);
  if (!e) return;
  if (e.sub && mainPanel?.contains(row)) {
    if (subParent === row) closeSub();
    else openSub(row);
    return;
  }
  closeHold();
  e.run?.();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !holdEl.hidden) closeHold();
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

/** Put a sheet or full-screen layer away the way it arrived: it slides off, then closes. */
function dismiss(d: HTMLDialogElement): void {
  if (!d.open || d.dataset.leaving) return;
  if (calm()) return d.close();
  d.dataset.leaving = '1';
  window.setTimeout(() => {
    delete d.dataset.leaving;
    d.style.removeProperty('--from');
    d.style.removeProperty('--pull');
    d.close();
  }, 290);
}

// The phone's Back button closes whatever is open before it leaves the page. A cover can be
// opened over the scanner, so Back closes one layer at a time, the top one first.
const LAYERS = ['#cover', '#sheet', '#scanner'];
/** The next history step is ours, undoing the entry a layer added when it opened. */
let ownBack = false;
for (const id of LAYERS) {
  $(id).addEventListener('close', (ev) => {
    const d = ev.currentTarget as HTMLElement;
    // Closed by Back: its history entry has already gone.
    if (d.dataset.back) return void delete d.dataset.back;
    if (history.state?.ui) {
      ownBack = true;
      history.back();
    }
  });
}
/** The browser has already slid the page back itself (an edge swipe on an iPhone), so the app must not do it again. */
let swiped = false;
window.addEventListener('popstate', (ev) => {
  swiped = (ev as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition === true;
  closeHold();
  if (ownBack) return void (ownBack = false);
  for (const id of LAYERS) {
    const d = $<HTMLDialogElement>(id);
    if (!d.open) continue;
    d.dataset.back = '1';
    dismiss(d);
    return;
  }
});
for (const id of LAYERS) {
  const d = $<HTMLDialogElement>(id);
  // Escape, and the buttons inside a sheet that close it, go the same way as everything else.
  d.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    dismiss(d);
  });
  d.addEventListener('submit', (ev) => {
    if ((ev.target as HTMLFormElement).method !== 'dialog') return;
    ev.preventDefault();
    dismiss(d);
  });
}
// The scanner's own close button, caught before the scanner closes it on the spot.
$('#scanner').addEventListener(
  'click',
  (ev) => {
    if (!(ev.target as HTMLElement).closest('[data-scan="close"]')) return;
    ev.stopPropagation();
    dismiss($<HTMLDialogElement>('#scanner'));
  },
  true,
);

/**
 * Let a sheet be pulled down to put it away, as a phone's sheets are. `from` says where on it a
 * pull may begin. Only a mostly downward move counts, so a sideways one is left to whatever
 * scrolls sideways inside. A flick down sends it, as does letting go past a quarter of its height
 * unless the finger was heading back up; otherwise it springs back. Pushed up, it gives a little
 * and no more.
 */
function pullToClose(d: HTMLDialogElement, from: (target: HTMLElement, fromTop: number) => boolean): void {
  let finger = -1;
  let x0 = 0;
  let y0 = 0;
  let pulled = 0;
  let pulling = false;
  /** The last tenth of a second of the pull, for how fast it was moving when let go. */
  let recent: { y: number; t: number }[] = [];
  d.addEventListener('pointerdown', (ev) => {
    const t = ev.target as HTMLElement;
    if (finger !== -1 || d.dataset.leaving || t.closest('button, a, input, select') || !from(t, ev.clientY - d.getBoundingClientRect().top)) return;
    finger = ev.pointerId;
    x0 = ev.clientX;
    y0 = ev.clientY;
    pulled = 0;
    pulling = false;
  });
  d.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== finger) return;
    const dx = ev.clientX - x0;
    const dy = ev.clientY - y0;
    if (!pulling) {
      if (Math.hypot(dx, dy) < 8) return;
      if (dy <= 0 || Math.abs(dx) > dy) {
        finger = -1;
        return;
      }
      pulling = true;
      recent = [];
      try {
        d.setPointerCapture(finger);
      } catch {
        /* the finger has already lifted */
      }
      d.style.transition = 'none';
    }
    pulled = dy >= 0 ? dy : Math.max(-14, dy * 0.2);
    const now = performance.now();
    recent.push({ y: ev.clientY, t: now });
    while (recent.length > 2 && now - recent[0].t > 100) recent.shift();
    d.style.transform = `translateY(${pulled}px)`;
    d.style.setProperty('--pull', String(Math.max(0, Math.min(1, pulled / d.offsetHeight))));
  });
  const letGo = (ev: PointerEvent): void => {
    if (ev.pointerId !== finger) return;
    finger = -1;
    if (!pulling) return;
    pulling = false;
    // Pixels a millisecond, downward, over the last moment before letting go.
    const a = recent[0];
    const b = recent[recent.length - 1];
    const speed = a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
    d.style.transition = '';
    d.style.transform = '';
    if ((pulled > 30 && speed > 0.5) || (pulled > Math.min(160, d.offsetHeight / 4) && speed > -0.2)) {
      // It carries on down from where the finger left it.
      d.style.setProperty('--from', `${pulled}px`);
      if (history.state?.ui) history.back();
      else dismiss(d);
    } else d.style.removeProperty('--pull');
  };
  d.addEventListener('pointerup', letGo);
  d.addEventListener('pointercancel', letGo);
}
// The filter sheet scrolls, so only its top edge pulls; the cover has nothing to scroll up and
// down, so it pulls from anywhere.
pullToClose($<HTMLDialogElement>('#sheet'), (t, fromTop) => Boolean(t.closest('.sheet-bar')) || fromTop < 30);
pullToClose($<HTMLDialogElement>('#cover'), () => true);
// Tapping the dimmed page above the cover puts it away too.
$('#cover').addEventListener('click', (ev) => {
  if (ev.target === ev.currentTarget && ev.clientY < (ev.currentTarget as HTMLElement).getBoundingClientRect().top) dismiss(ev.currentTarget as HTMLDialogElement);
});

// ---- an app, not a page: nothing zooms, nothing selects, and a long press brings up no browser menu
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (ev) => ev.preventDefault());
window.addEventListener('wheel', (ev) => ev.ctrlKey && ev.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (ev) => {
  if (!(ev.target as HTMLElement).closest('input, textarea')) ev.preventDefault();
});
// Once the large title has scrolled off, the search bar takes on its frosted backing.
window.addEventListener('scroll', () => document.body.classList.toggle('stuck', window.scrollY > $('#lead').offsetHeight - 6), { passive: true });
$('#cover').addEventListener('close', () => {
  coverTurn++;
  $('#cover').innerHTML = '';
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

interface MenuSpec {
  title: string;
  list: MenuItem[];
  pick: (v: string) => void;
}

/** The menus behind the picker chips and the quick panel's side columns. */
function openPicker(key: string, anchor: HTMLElement): void {
  const spec = menuFor(key);
  if (spec) openMenu(anchor, spec.title, spec.list, spec.pick);
}

function menuFor(key: string): MenuSpec | null {
  const sh = shelf();
  if (key === 'sort') {
    const list = sortsFor(sh).map(([v, l]): MenuItem => ({ v, label: l, on: F.sort === v }));
    return { title: 'Sort by', list, pick: (v) => apply({ sort: v as Sort }, true) };
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
    return { title: 'Price', list, pick: (v) => apply({ max: Number(v) || 0 }, true) };
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
    return { title: 'Speed', list, pick: (v) => apply({ perf: Number(v) || 0 }) };
  }
  if (key.startsWith('brand:')) {
    const id = key.slice(6);
    const sys = systemOptions();
    const opt = sys.find((o) => o.id === id);
    if (!opt) return null;
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
      { v: '*', label: 'Any brand', meta: countText(any), on: on && !F.brands.length },
      { v: '', label: '', sep: true },
      ...makers.map(({ b, p }): MenuItem => ({
        v: b,
        label: b,
        meta: p ? `${p.n.toLocaleString('en-GB')} · from £${p.from}` : undefined,
        on: on && F.brands.length === 1 && F.brands[0] === b,
      })),
    ];
    if (on) list.push({ v: '', label: '', sep: true }, { v: 'off', label: `Show all ${PRESETS.find((p) => p.id === F.preset)?.label.toLowerCase() ?? 'items'}`, quiet: true });
    return {
      title: `${opt.label} brand`,
      list,
      pick: (v) => {
        if (v === 'off') apply({ fx: others, brands: [] });
        else apply({ fx: withSys, brands: v === '*' ? [] : [v] });
      },
    };
  }
  if (key.startsWith('group:')) {
    const g = facetGroups().find((x) => x.name === key.slice(6));
    if (!g) return null;
    const others = F.fx.filter((id) => !g.options.some((o) => o.id === id));
    const server = g.options.some((o) => o.server);
    const list: MenuItem[] = [
      { v: '*', label: `Any ${g.name.toLowerCase()}`, on: !g.options.some((o) => F.fx.includes(o.id)) },
      ...g.options
        .map((o): MenuItem => ({ v: o.id, label: o.label, meta: o.server ? undefined : countText(preview({ fx: [...others, o.id] })), on: F.fx.includes(o.id) }))
        .filter((i) => i.on || i.meta !== '0'),
    ];
    return { title: g.name, list, pick: (v) => apply({ fx: v === '*' ? others : [...others, v] }, server) };
  }
  return null;
}

// ------------------------------------------------------------------ actions

/** Which screen a set of choices shows. Moving between two of these is a change of place, not a refinement. */
const screenOf = (f: Filters): string =>
  f.mode === 'up' ? (f.pick ? `up:${f.pick}` : 'up') : f.mode === 'add' ? `add:${f.pick}` : f.mode ? f.mode : !f.q.trim() && !f.preset ? 'home' : 'list';

/**
 * Change screen the way a phone does: the new one slides in from the right while the old one
 * eases back to the left, and the reverse on the way out. The old screen is kept for the length
 * of the move as a lifeless copy, so the page itself changes at once and anything that follows
 * (focusing a field, scrolling to the top) still finds the new screen in place.
 */
function slide(way: 'push' | 'pop', change: () => void): void {
  const screen = $('#screen');
  const bar = $('.top');
  if (calm() || swiped || document.visibilityState !== 'visible' || typeof screen.animate !== 'function') return change();
  const was = screen.getBoundingClientRect();
  const barWas = bar.offsetHeight;
  const ghost = screen.cloneNode(true) as HTMLElement;
  ghost.removeAttribute('id');
  for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id');
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.className = 'old-screen';
  document.body.append(ghost);
  // The bar is solid for the length of the move, so neither screen can show through it.
  document.body.classList.add('sliding');
  change();
  // Going forward, the new screen arrives over the old one, which eases back and dims. Going
  // back is the same film in reverse: the old screen slides off to show the new one beneath.
  const push = way === 'push';
  // The bar gains or loses its row of categories between screens, and the new screen starts
  // lower or higher to match. Where it has grown, the top of the old screen would sit behind
  // the new row, so that strip is cut off. Where it has shrunk on the way back, the old screen
  // (in front) reaches up to cover the gap, so the new one is not seen until it is uncovered.
  const grew = bar.offsetHeight - barWas;
  const cut = Math.max(0, grew);
  const reach = !push && grew < 0 ? -grew : 0;
  ghost.style.cssText = `top:${was.top - reach}px;left:${was.left}px;width:${was.width}px;padding-top:${reach}px;clip-path:inset(${cut}px -48px 0 -48px)`;
  const timing = { duration: 440, easing: EASE };
  const across: Keyframe[] = [{ transform: 'translateX(100%)' }, { transform: 'none' }];
  const behind: Keyframe[] = [{ transform: 'none', opacity: 1 }, { transform: 'translateX(-28%)', opacity: 0.35 }];
  ghost.classList.toggle('on-top', !push);
  screen.classList.toggle('on-top', push);
  (push ? screen : ghost).animate(push ? across : [...across].reverse(), { ...timing, fill: push ? 'none' : 'forwards' });
  (push ? ghost : screen).animate(push ? behind : [...behind].reverse(), { ...timing, fill: push ? 'forwards' : 'none' });
  // Cleared on a timer, not when the animation reports back: a phone locked mid-move must not leave it behind.
  window.setTimeout(() => {
    ghost.remove();
    screen.classList.remove('on-top');
    document.body.classList.remove('sliding');
  }, timing.duration + 60);
}

/** `push` marks a move the Back button should undo (a new screen), as opposed to a refinement of this one. */
function apply(patch: Partial<Filters>, refetch = false, push = false): void {
  const to = screenOf({ ...F, ...patch });
  const moving = push && screenOf(F) !== to;
  const change = (): void => {
    Object.assign(F, patch);
    writeHash(push);
    shown = PAGE;
    if (refetch) void load();
    // A list that is still being fetched shows its placeholders straight away, so there is a screen to slide in.
    if (!refetch || (moving && loading)) render();
  };
  // Going back to the start reads as going back, whichever button did it.
  if (moving) slide(to === 'home' ? 'pop' : 'push', change);
  else change();
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
    case 'addons':
      $<HTMLDialogElement>('#scanner').close();
      addonsFrom = location.hash;
      apply({ ...DEFAULTS, mode: 'add', pick: v }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'flow-back':
      // Back to the list the add-ons were opened from, as the phone's Back button would; from a
      // saved link there is nothing to go back to, so it goes to the start.
      if (addonsFrom !== null) history.back();
      else apply({ ...DEFAULTS }, true, true);
      break;
    case 'addon':
      toggleAddon(flowHost, el);
      break;
    case 'addon-more':
      moreAddons(flowHost, F, $('#results'), v);
      break;
    case 'addon-clear':
      clearAddons(flowHost);
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
    case 'activity':
      apply({ ...DEFAULTS, mode: v === 'sold' ? 'sold' : 'in' }, true, true);
      window.scrollTo({ top: 0 });
      break;
    case 'ac':
      apply({ ac: v });
      break;
    case 'retry-activity':
      forgetLog();
      apply({});
      break;
    case 'focus':
      apply({ fo: F.fo === v ? '' : v }, true);
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
    case 'cover': {
      const it = findItem(v);
      if (it) void openCover(it, el);
      break;
    }
    case 'cover-close':
      // Closing is the same step as the phone's Back button, so there is one path to keep right.
      if (history.state?.ui) history.back();
      else dismiss($<HTMLDialogElement>('#cover'));
      break;
    case 'cover-part':
      coverTo(v);
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
      // Tapping the button its panel came from puts the panel away.
      if (!holdEl.hidden) closeHold();
      else void openSheet();
      break;
    case 'dock-search':
      if (swallowTap) break;
      if (!holdEl.hidden) closeHold();
      else focusSearch();
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
  if (ev.target === ev.currentTarget) dismiss(ev.currentTarget as HTMLDialogElement);
});

// Stock moves while the phone is in a pocket: on return, anything over a minute old is fetched again.
// The stock record moves on while the phone is in a pocket too.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  forgetLog();
  if (isHome()) void fillActivity(flowHost, $('#results'));
  else if (F.mode === 'in' || F.mode === 'sold') render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || Date.now() - loadedAt < 60_000 || isHome()) return;
  clearCache();
  clearStock();
  loadedAt = Date.now();
  void load(true);
});

// Back and forward. Leaving the start screen is a push; everything else is a step back.
window.addEventListener('hashchange', () => {
  const from = screenOf(F);
  const change = (): void => {
    readHash();
    $<HTMLInputElement>('#q').value = F.q;
    void load();
    if (loading) render();
  };
  const p = new URLSearchParams(location.hash.slice(1));
  const toHome = !p.get('m') && !p.get('q') && !p.get('p');
  if (from === 'home' && toHome) change();
  else slide(from === 'home' ? 'push' : 'pop', change);
  swiped = false;
});

// ------------------------------------------------------------------ boot

readHash();
$<HTMLInputElement>('#q').value = F.q;
void load();
// Handy when checking parsing against live data from the dev console.
if (import.meta.env.DEV) {
  // Simulated customers for the step-up flow (see src/sim.ts): `await shelf.sim()` in the console.
  const sim = async (limit = stepLimit): Promise<unknown> =>
    (await import('./sim.ts')).simulate([...(await flowHost.loadKind('phone')), ...(await flowHost.loadKind('tablet'))], limit);
  // Every product in stock through the add-on rules and the guard (see src/addonAudit.ts): `await shelf.audit()`.
  const audit = async (): Promise<unknown> => {
    const { audit: run, auditText } = await import('./addonAudit.ts');
    const { branchStock } = await import('./api.ts');
    const report = run((await branchStock(branch)).map((h, i) => toItem(h, i, ctx)));
    console.log(auditText(report, branch));
    return report;
  };
  Object.assign(window, { shelf: { items: () => items, hits: () => hits, openScan, sim, audit } });
}
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
