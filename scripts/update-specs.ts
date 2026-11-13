// Rebuilds the phone and tablet spec sheets the app ships with:  npm run specs
//
// CeX's records name a phone but say nothing of its camera, battery or screen, so those facts
// are read from GSMArena's device pages, one page per model, and saved to src/data/specs.json.
// The app itself never asks GSMArena anything: it reads the saved file.
//
// It runs every half hour as part of the stock watch (scripts/stock-watch.sh) and goes by the
// shop's clock:
//   9am to 6pm  day      looks at what CeX shows in stock and reads the sheet of any model that has
//                        just arrived without one
//   6pm to 9pm  evening  works through the models that still have no sheet; once there are none,
//                        re-reads a few of the oldest sheets
// By hand:
//   npm run specs              look up models in scripts/spec-models.json that have no sheet yet
//   npm run specs -- --cex     first add whatever the store stocks now to that list
//   npm run specs -- --all     re-read every sheet, not just the missing ones
//   npm run specs -- --max=30  ask for at most 30 pages this run (default 18)
//   npm run specs -- --retry   try again the models GSMArena had no match for
//
// GSMArena refused an address for ten hours after roughly 50 page requests in a short spell, so
// that is treated as the day's allowance: 60% for the evening's backlog, 40% kept for arrivals
// during the day, a few pages a run, several seconds apart. It stops at the first refusal and
// keeps what it has. A model it cannot match to exactly one device gets no sheet: nothing is
// guessed, and it is not asked about again for a month.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../src/api.ts';
import { norm } from '../src/eol.ts';
import type { Sheet, SheetFile } from '../src/specs.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = ROOT + 'src/data/specs.json';
const MODELS = ROOT + 'scripts/spec-models.json';
const CACHE = ROOT + '.cache/specs/';
const SITE = 'https://www.gsmarena.com/';
const CLIENT = 'Mozilla/5.0 (compatible; spec-sheet-reader/1.0)';
/** Pause between pages, in ms. */
const GAP = 7000;
const STORE = 'Eastbourne';

const STATE = ROOT + 'scripts/spec-state.json';
/** Page requests a day. GSMArena refused an address after roughly 50 in a short spell. */
const ALLOWANCE = 50;
/** How the day's allowance is split: the backlog after closing, and arrivals while open. */
const SHARE = { evening: 0.6, day: 0.4 };
/** Most pages in one automatic run, so no run comes near the limit on its own. */
const PER_RUN = 10;
/** Shop hours, in its own time. The evening run has the three hours after closing. */
const OPEN = 9;
const CLOSE = 18;
/** Days before asking again about a model GSMArena had no match for, and before re-reading a sheet. */
const RETRY_MISS = 30;
const REFRESH = 120;

const args = new Set(process.argv.slice(2));
/** Pages this run may still ask for; set once the day's allowance has been looked at. */
let budget = 0;
mkdirSync(CACHE, { recursive: true });

type ModelList = Record<string, string[]>;
interface Models {
  phones: ModelList;
  tablets: ModelList;
}

// ---------------------------------------------------------------- reading pages

/** Time to stop asking: GSMArena refused, or this run has had its share of pages. */
class Stop extends Error {}

let lastAsk = 0;
let asked = 0;

async function ask(path: string): Promise<Response> {
  if (asked >= budget) throw new Stop(`reached this run's limit of ${budget} pages`);
  const wait = lastAsk + GAP + Math.random() * 2000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAsk = Date.now();
  asked++;
  return fetch(SITE + path, { headers: { 'user-agent': CLIENT }, redirect: 'manual' });
}

async function page(path: string, file: string, maxAgeDays: number): Promise<string> {
  const f = CACHE + file;
  if (existsSync(f) && Date.now() - statSync(f).mtimeMs < maxAgeDays * 864e5) return readFileSync(f, 'utf8');
  let res = await ask(path);
  // A device page asked for under a slightly different name is sent on to its real address.
  const moved = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
  if (moved) res = await ask(moved.replace(SITE, ''));
  const text = await res.text();
  if (res.status === 429 || res.status === 403) {
    const hours = Math.ceil(Number(res.headers.get('retry-after')) / 3600);
    throw new Stop(`GSMArena is refusing requests from this address${hours ? ` for about ${hours} more hours` : ''}`);
  }
  // A human check, or the few bytes it sends in place of a page once it has had enough.
  if (/Turnstile check|Too Many Requests/i.test(text.slice(0, 3000)) || text.length < 2000) throw new Stop('GSMArena asked for a human check');
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  writeFileSync(f, text);
  return text;
}

// ---------------------------------------------------------------- finding the device

/** GSMArena's way of writing a device name in an address: "apple_iphone_se_(2020)". */
const addressOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9()+.]+/g, '_').replace(/^_|_$/g, '');

interface Device {
  id: number;
  maker: string;
  /** URL of its page, when known from a brand list (the quick list only gives the id). */
  path?: string;
  name: string;
  alias: string;
}

interface Maker {
  id: string;
  name: string;
  devices: Device[];
  /** Brand list pages already read into `devices`. */
  listed: number;
}

const makers = new Map<string, Maker>();
const makerKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The list behind GSMArena's own search box: the devices people look up most. */
async function loadQuickList(): Promise<void> {
  const home = await page('', 'home.html', 1);
  const path = home.match(/AUTOCOMPLETE_LIST_URL\s*=\s*"\/(quicksearch-\d+\.jpg)"/)?.[1];
  if (!path) throw new Error('GSMArena home page no longer names its device list');
  const [names, list] = JSON.parse(await page(path, 'list.json', 1)) as [Record<string, string>, [number, number, string, string, string, string][]];
  for (const [id, name] of Object.entries(names)) makers.set(makerKey(name), { id, name, devices: [], listed: 0 });
  for (const [makerId, id, name, , , alias] of list) makers.get(makerKey(names[makerId]))?.devices.push({ id, maker: names[makerId], name, alias: alias ?? '' });
}

/** One more page of a brand's full device list, newest first. False when there are no more. */
async function listMore(m: Maker): Promise<boolean> {
  const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const n = m.listed + 1;
  if (n > 18) return false;
  const html = await page(n === 1 ? `${slug}-phones-${m.id}.php` : `${slug}-phones-f-${m.id}-0-p${n}.php`, `brand-${m.id}-${n}.html`, 7);
  m.listed = n;
  const found = [...html.matchAll(/<li><a href="([^"]+-(\d+)\.php)"><img[^>]*><strong><span>(.*?)<\/span><\/strong><\/a><\/li>/g)];
  for (const [, path, id, name] of found) {
    if (!m.devices.some((d) => d.id === Number(id))) m.devices.push({ id: Number(id), maker: m.name, path, name: name.replace(/<br\s*\/?>/g, ' '), alias: '' });
  }
  return found.length > 0 && html.includes(`-p${n + 1}.php`);
}

/** CeX files some sub-brands as makers of their own. */
const SUB_BRANDS: Record<string, { maker: string; prefix: string }> = {
  redmi: { maker: 'xiaomi', prefix: 'Redmi ' },
  poco: { maker: 'xiaomi', prefix: 'Poco ' },
};

/** Where CeX's name for a model differs from GSMArena's. Keyed by CeX maker and model. */
const RENAMED: Record<string, string> = {
  'apple|iphone se 2nd gen': 'iPhone SE (2020)',
  'apple|iphone se 3rd gen': 'iPhone SE (2022)',
  'samsung|galazy s26 fe': 'Galaxy S26 FE',
};

const strict = (s: string): string => s.toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
const noNet = (s: string): string => strict(s.replace(/\b(?:5g|4g|lte)\b/gi, ''));

/** The one device a name means, or null when there is none or more than one. */
function pick(pool: Device[], names: string[]): Device | null {
  const want = names.map(strict);
  let hit = pool.filter((d) => want.includes(strict(d.name)));
  if (!hit.length) hit = pool.filter((d) => d.alias && want.includes(strict(d.alias)));
  if (!hit.length) {
    const loose = names.map(noNet);
    hit = pool.filter((d) => loose.includes(noNet(d.name)));
  }
  return hit.length === 1 ? hit[0] : null;
}

async function findDevice(cexMaker: string, cexModel: string): Promise<Device | null> {
  const sub = SUB_BRANDS[makerKey(cexMaker)];
  const m = makers.get(sub?.maker ?? makerKey(cexMaker));
  if (!m) return null;
  const model = RENAMED[`${cexMaker.toLowerCase()}|${cexModel.toLowerCase()}`] ?? cexModel;
  const names = [model, (sub?.prefix ?? '') + model, `${m.name} ${model}`];
  let d = pick(m.devices, names);
  // Not among the popular ones: read on through the brand's full list.
  while (!d && (await listMore(m))) d = pick(m.devices, names);
  return d;
}

// ---------------------------------------------------------------- reading a sheet

const text = (html: string): string =>
  html
    .replace(/<br\s*\/?>/g, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Every row of the spec table, by GSMArena's field name where it has one, else by its label. */
function rows(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, label, field, value] of html.matchAll(/<td class="ttl">(.*?)<\/td>\s*<td class="nfo"(?: data-spec="([^"]*)")?[^>]*>([\s\S]*?)<\/td>/g)) {
    const key = field || text(label).toLowerCase();
    if (key && !out.has(key)) out.set(key, text(value));
  }
  return out;
}

const num = (s: string | undefined, re: RegExp): number => Number(s?.match(re)?.[1]) || 0;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "Qualcomm SM8550-AC Snapdragon 8 Gen 2 (4 nm)" -> "Snapdragon 8 Gen 2", for the version sold here. */
function chipName(raw: string): string {
  const parts = raw.split('|').map((s) => s.trim()).filter(Boolean);
  const here = parts.find((p) => /international|europe|emea|global|\buk\b|\brow\b/i.test(p)) ?? parts[0] ?? '';
  return here
    .replace(/\s-\s.*$/, '')
    .replace(/\([^)]*nm\)/gi, ' ')
    .replace(/\b(?:SM\d{4}[\w-]*|SDM\d+\w*|MSM\d+\w*|MT\d{4}[\w/]*|S5E\d+\w*|SC\d{4}\w*)\b/g, ' ')
    .replace(/\bQualcomm\b/gi, ' ')
    .replace(/\bMediatek\b(?=\s+(?:Dimensity|Helio))/gi, ' ')
    .replace(/\bMediatek\b/gi, 'MediaTek')
    .replace(/\s+/g, ' ')
    .trim();
}

function readSheet(html: string, id: number): Sheet | null {
  const r = rows(html);
  const name = text(html.match(/<h1[^>]*data-spec="modelname"[^>]*>(.*?)<\/h1>/)?.[1] ?? '');
  if (!name || !r.size) return null;

  // "2020, November 24. Released 2020, December 21": the release, or the announcement before it.
  const launch = r.get('year') ?? '';
  const when = launch.match(/Released (\d{4})(?:, (\w+))?/) ?? launch.match(/(\d{4})(?:, (\w+))?/);
  const year = Number(when?.[1]) || 0;
  const month = when?.[2] ? MONTHS.indexOf(when[2].toLowerCase()) + 1 : 0;

  const display = r.get('displaytype') ?? '';
  const cams = (r.get('cam1modules') ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  const zooms = cams.filter((c) => /telephoto/i.test(c)).map((c) => num(c, /([\d.]+)x optical zoom/));
  const charging = (r.get('charging') ?? '').split('|').map((s) => s.trim());
  const cordless = charging.find((c) => /wireless/i.test(c) && !/reverse/i.test(c));
  const ram = [...new Set([...(r.get('internalmemory') ?? '').matchAll(/([\d.]+)GB RAM/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const os = (r.get('os') ?? '').split(',').map((s) => s.trim());
  const body = [r.get('bodyother'), r.get('build')].join(' ');

  const s: Sheet = {
    n: name,
    id,
    y: year,
    scr: num(r.get('displaysize'), /([\d.]+)\s*inch/),
    mah: num(r.get('batdescription1'), /(\d{3,6})\s*mAh/),
    mp: num(cams[0], /([\d.]+)\s*MP/),
    chip: chipName(r.get('chipset') ?? ''),
  };
  if (month) s.m = month;
  if (/oled/i.test(display)) s.pan = 'OLED';
  else if (/lcd|ips|tft|pls/i.test(display)) s.pan = 'LCD';
  const hz = num(display, /(\d{2,3})\s*Hz/);
  if (hz) s.hz = hz;
  const res = r.get('displayresolution')?.match(/(\d{3,4}) x (\d{3,4})/);
  if (res) s.res = `${res[1]}x${res[2]}`;
  const watts = num(charging.find((c) => /wired/i.test(c)), /([\d.]+)W/);
  if (watts) s.w = watts;
  if (cordless) s.wl = num(cordless, /([\d.]+)W/);
  if (cams.some((c) => /ultrawide/i.test(c))) s.uw = 1;
  if (zooms.length && Math.max(...zooms) > 0) s.tz = Math.max(...zooms);
  const selfie = num(r.get('cam2modules'), /([\d.]+)\s*MP/);
  if (selfie) s.sf = selfie;
  if (ram.length) s.ram = ram;
  if (/\b5G\b/.test(r.get('technology') ?? '')) s.g5 = 1;
  const ip = body.match(/\bIP[X\d]\d\b/i)?.[0];
  if (ip) s.ip = ip.toUpperCase();
  if (r.has('memoryslot') && !/^no\b/i.test(r.get('memoryslot')!)) s.sd = 1;
  if (/^yes/i.test(r.get('3.5mm jack') ?? '')) s.jack = 1;
  if (/^yes/i.test(r.get('nfc') ?? '')) s.nfc = 1;
  const weight = num(r.get('weight'), /([\d.]+)\s*g\b/);
  if (weight) s.wt = weight;
  if (/type-c/i.test(r.get('usb') ?? '')) s.usbc = 1;
  if (os[0]) s.os = os[0];
  const upTo = os.find((o) => /^upgradable to/i.test(o))?.replace(/^upgradable to\s*/i, '');
  if (upTo) s.up = upTo;

  // GSMArena's own lab results, on the models it has reviewed.
  const page = text(html);
  const active = page.match(/Active use score (\d+):(\d+)h/);
  if (active) s.act = Number(active[1]) * 60 + Number(active[2]);
  const endurance = num(page, /Endurance rating (\d+)h/);
  if (endurance) s.end = endurance;
  const nits = num(page, /(\d{3,4}) nits max brightness \(measured\)/);
  if (nits) s.nits = nits;
  const lufs = page.match(/(-\d+(?:\.\d+)?) LUFS/);
  if (lufs) s.lufs = Number(lufs[1]);
  // "GeekBench: 5833 (v5), 6747 (v6)": versions do not compare with each other, so each is kept apart.
  const bench = (r.get('tbench') ?? '').match(/GeekBench:([^|]*)/)?.[1] ?? '';
  for (const [, score, version] of bench.matchAll(/(\d{3,6}) \(v([\d.]+)\)/g)) {
    if (version === '6') s.gb6 = Number(score);
    else if (version.startsWith('5')) s.gb5 = Number(score);
  }
  return s;
}

// ---------------------------------------------------------------- what the store stocks

interface Stocked {
  kind: keyof Models;
  maker: string;
  model: string;
}

/** The phone and tablet models the store has on its shelves right now, in one request to CeX. */
async function inStock(): Promise<Stocked[]> {
  const groups: [keyof Models, string, string[]][] = [
    ['phones', 'Phone Model', ['categoryFriendlyName:Android Phones', 'productLineName:iPhones']],
    ['tablets', 'Model Name', ['categoryFriendlyName:Tablets - Android', 'categoryFriendlyName:Tablets - Windows']],
  ];
  const requests = groups.map(([, field, cats]) => ({
    indexName: CONFIG.index,
    params: new URLSearchParams({ query: '', hitsPerPage: '1000', attributesToRetrieve: JSON.stringify(['Manufacturer', field]), facetFilters: JSON.stringify([[`stores:${STORE}`], cats]) }).toString(),
  }));
  const res = await fetch(`${CONFIG.endpoint}?x-algolia-application-id=${CONFIG.appId}&x-algolia-api-key=${CONFIG.apiKey}`, { method: 'POST', body: JSON.stringify({ requests }) });
  if (!res.ok) throw new Error(`CeX search: HTTP ${res.status}`);
  const results = (await res.json()).results as { hits?: Record<string, unknown>[] }[];
  const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v)).trim();
  const out = new Map<string, Stocked>();
  groups.forEach(([kind, field], i) => {
    for (const h of results[i]?.hits ?? []) {
      const maker = first(h.Manufacturer);
      const model = first(h[field]);
      if (maker && model) out.set(`${kind}|${maker}|${model}`, { kind, maker, model });
    }
  });
  return [...out.values()];
}

// ---------------------------------------------------------------- the day's allowance

/**
 * What the script remembers between runs, in scripts/spec-state.json.
 *   used   – page requests made today, by when they were made
 *   fresh  – models that came into stock without a sheet and have not been looked up yet
 *   missed – models GSMArena has no exact match for, and the day that was last checked
 *   read   – the day each sheet was read
 */
interface State {
  day: string;
  used: Record<string, number>;
  fresh: string[];
  missed: Record<string, string>;
  read: Record<string, string>;
}

type Mode = 'day' | 'evening' | 'manual';

/** The date and hour in the shop's own time zone, whatever clock the machine running this keeps. */
function shopTime(): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

const daysSince = (date: string | undefined, today: string): number => (date ? (Date.parse(today) - Date.parse(date)) / 864e5 : Infinity);
const keyOf = (maker: string, model: string): string => `${maker.toLowerCase().replace(/\s+/g, '')}|${norm(model)}`;

// ---------------------------------------------------------------- run

const now = shopTime();
const asked0 = [...args].find((a) => a.startsWith('--mode='))?.slice(7);
let mode: Mode | null = asked0 === 'day' || asked0 === 'evening' ? asked0 : 'manual';
// Left to itself it goes by the shop's clock: new arrivals while open, the backlog after closing.
if (args.has('--auto')) mode = now.hour >= OPEN && now.hour < CLOSE ? 'day' : now.hour >= CLOSE && now.hour < CLOSE + 3 ? 'evening' : null;
if (!mode) {
  console.log(`${now.hour}:00 in the shop: nothing to do outside ${OPEN}:00 to ${CLOSE + 3}:00.`);
  process.exit(0);
}

const models = JSON.parse(readFileSync(MODELS, 'utf8')) as Models;
const file: SheetFile = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { at: '', source: 'GSMArena', sheets: {} };
const state: State = { day: now.day, used: {}, fresh: [], missed: {}, read: {}, ...(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}) };
const before = { models: JSON.stringify(models), state: JSON.stringify(state) };
// A new day, a new allowance.
if (state.day !== now.day) {
  state.day = now.day;
  state.used = {};
}

// What has come into stock since last time. A manual run only asks CeX when told to.
if (mode !== 'manual' || args.has('--cex')) {
  try {
    let added = 0;
    for (const s of await inStock()) {
      const list = (models[s.kind][s.maker] ??= []);
      if (!list.includes(s.model)) {
        list.push(s.model);
        added++;
      }
      // In stock with no sheet: first in the queue, unless GSMArena was found not to have it.
      const k = keyOf(s.maker, s.model);
      if (!file.sheets[k] && !state.fresh.includes(k) && daysSince(state.missed[k], now.day) > RETRY_MISS) state.fresh.push(k);
    }
    console.log(`CeX ${STORE}: ${added} models not seen before, ${state.fresh.length} in stock without a sheet`);
  } catch (e) {
    console.log(`Could not read CeX stock (${e instanceof Error ? e.message : e}); carrying on with the saved list.`);
  }
}

// How many pages this run may ask for: its share of the day's allowance, a few at a time.
const share = mode === 'manual' ? Infinity : Math.floor(ALLOWANCE * SHARE[mode]) - (state.used[mode] ?? 0);
const cap = [...args].find((a) => a.startsWith('--max='))?.slice(6);
budget = Math.max(0, Math.min(share, cap !== undefined && /^\d+$/.test(cap) ? Number(cap) : mode === 'manual' ? 18 : PER_RUN));

interface Job {
  key: string;
  maker: string;
  model: string;
}
const every: Job[] = [];
for (const kind of ['phones', 'tablets'] as const) {
  for (const [maker, list] of Object.entries(models[kind])) for (const model of list) every.push({ key: keyOf(maker, model), maker, model });
}
const waiting = every.filter((j) => !file.sheets[j.key] && (args.has('--retry') || daysSince(state.missed[j.key], now.day) > RETRY_MISS));
const isFresh = (j: Job): boolean => state.fresh.includes(j.key);
let todo: Job[];
if (args.has('--all')) todo = every;
// While the shop is open, only what has just arrived; the backlog waits for the evening.
else if (mode === 'day') todo = waiting.filter(isFresh);
else todo = [...waiting.filter(isFresh), ...waiting.filter((j) => !isFresh(j))];
// Nothing waiting after closing: re-read a few of the oldest sheets, which picks up tests GSMArena has added since.
if (!todo.length && mode === 'evening') {
  todo = every
    .filter((j) => file.sheets[j.key] && daysSince(state.read[j.key] ?? file.at, now.day) > REFRESH)
    .sort((x, y) => (state.read[x.key] ?? '').localeCompare(state.read[y.key] ?? ''))
    .slice(0, 3);
}
console.log(`${mode}: ${todo.length} to look up, ${Object.keys(file.sheets).length} sheets saved, up to ${budget} pages this run (${mode === 'manual' ? 'no daily share' : `${state.used[mode] ?? 0} of ${Math.floor(ALLOWANCE * SHARE[mode])} used today`})`);

const unmatched: string[] = [];
let read = 0;
try {
  if (todo.length && budget > 0) await loadQuickList();
  for (const t of budget > 0 ? todo : []) {
    const d = await findDevice(t.maker, t.model);
    const html = d ? await page(d.path ?? `${addressOf(`${d.maker} ${d.name}`)}-${d.id}.php`, `d-${d.id}.html`, mode === 'evening' && file.sheets[t.key] ? 1 : 120) : '';
    const sheet = d ? readSheet(html, d.id) : null;
    state.fresh = state.fresh.filter((k) => k !== t.key);
    if (!sheet) {
      // Remembered, so the allowance is not spent asking again every day.
      state.missed[t.key] = now.day;
      unmatched.push(`${t.maker} ${t.model}${d ? ` (page ${d.id} unreadable)` : ''}`);
      continue;
    }
    file.sheets[t.key] = sheet;
    state.read[t.key] = now.day;
    delete state.missed[t.key];
    read++;
  }
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.log(`Stopped: ${e.message}.`);
}
if (mode !== 'manual') state.used[mode] = (state.used[mode] ?? 0) + asked;

// Only what changed is written, so a run that found nothing leaves no trace to commit.
if (read) {
  file.at = now.day;
  file.sheets = Object.fromEntries(Object.entries(file.sheets).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n');
}
if (JSON.stringify(models) !== before.models) writeFileSync(MODELS, JSON.stringify(models, null, 2) + '\n');
if (JSON.stringify(state) !== before.state) writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
const left = every.filter((j) => !file.sheets[j.key] && daysSince(state.missed[j.key], now.day) > RETRY_MISS).length;
console.log(`Read ${read} sheets with ${asked} page requests. ${Object.keys(file.sheets).length} saved, ${left} still to look up.`);
if (unmatched.length) console.log(`No exact match on GSMArena for ${unmatched.length}:\n  ${unmatched.join('\n  ')}`);
