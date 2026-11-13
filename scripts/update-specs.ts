// Rebuilds the phone and tablet spec sheets the app ships with:  npm run specs
//
// CeX's records name a phone but say nothing of its camera, battery or screen, so those facts
// are read from GSMArena's device pages, one page per model, and saved to src/data/specs.json.
// The app itself never asks GSMArena anything: it reads the saved file.
//
//   npm run specs              look up models in scripts/spec-models.json that have no sheet yet
//   npm run specs -- --cex     first add whatever the store stocks now to that list
//   npm run specs -- --all     re-read every sheet, not just the missing ones
//   npm run specs -- --max=30  ask for at most 30 pages this run (default 18)
//
// GSMArena allows roughly 50 page requests in a short spell, then refuses that address for ten
// hours. So each run asks for only a few pages, several seconds apart, keeps every page it has
// read in .cache/specs, and stops at the first refusal, saving what it has. Run it again another
// day to carry on. A model it cannot match to exactly one device gets no sheet: nothing is guessed.

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

const args = new Set(process.argv.slice(2));
/** Pages to ask for in one run, kept well under what gets an address refused. */
const MAX = Number([...args].find((a) => a.startsWith('--max='))?.slice(6) ?? 18);
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
  if (asked >= MAX) throw new Stop(`reached this run's limit of ${MAX} pages`);
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
  return s;
}

// ---------------------------------------------------------------- what CeX stocks

/** Add the phone and tablet models the store has in stock now to the list. */
async function addFromCex(models: Models): Promise<number> {
  const groups: [keyof Models, string, string[]][] = [
    ['phones', 'Phone Model', ['categoryFriendlyName:Android Phones', 'productLineName:iPhones']],
    ['tablets', 'Model Name', ['categoryFriendlyName:Tablets - Android', 'categoryFriendlyName:Tablets - Windows']],
  ];
  const ask = async (requests: unknown[]): Promise<{ facets?: Record<string, Record<string, number>> }[]> => {
    const res = await fetch(`${CONFIG.endpoint}?x-algolia-application-id=${CONFIG.appId}&x-algolia-api-key=${CONFIG.apiKey}`, { method: 'POST', body: JSON.stringify({ requests }) });
    if (!res.ok) throw new Error(`CeX search: HTTP ${res.status}`);
    return (await res.json()).results;
  };
  const req = (filters: string[][], facet: string): unknown => ({
    indexName: CONFIG.index,
    params: new URLSearchParams({ query: '', hitsPerPage: '0', facets: JSON.stringify([facet]), maxValuesPerFacet: '1000', facetFilters: JSON.stringify(filters) }).toString(),
  });
  let added = 0;
  for (const [kind, field, cats] of groups) {
    const here = [`stores:${STORE}`];
    const [byMaker] = await ask([req([here, cats], 'Manufacturer')]);
    for (const maker of Object.keys(byMaker.facets?.Manufacturer ?? {})) {
      const [r] = await ask([req([here, cats, [`Manufacturer:${maker}`]], field)]);
      const list = (models[kind][maker] ??= []);
      for (const model of Object.keys(r.facets?.[field] ?? {})) {
        if (!list.includes(model)) {
          list.push(model);
          added++;
        }
      }
    }
  }
  return added;
}

// ---------------------------------------------------------------- run

const models = JSON.parse(readFileSync(MODELS, 'utf8')) as Models;
if (args.has('--cex')) {
  const added = await addFromCex(models);
  writeFileSync(MODELS, JSON.stringify(models, null, 2) + '\n');
  console.log(`Added ${added} models from CeX ${STORE} stock`);
}
const file: SheetFile = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { at: '', source: 'GSMArena', sheets: {} };
const todo: { key: string; maker: string; model: string }[] = [];
for (const kind of ['phones', 'tablets'] as const) {
  for (const [maker, list] of Object.entries(models[kind])) {
    for (const model of list) {
      const key = `${maker.toLowerCase().replace(/\s+/g, '')}|${norm(model)}`;
      if (args.has('--all') || !file.sheets[key]) todo.push({ key, maker, model });
    }
  }
}
console.log(`${todo.length} models to look up, ${Object.keys(file.sheets).length} sheets already saved`);

const unmatched: string[] = [];
let read = 0;
try {
  if (todo.length) await loadQuickList();
  for (const t of todo) {
    const d = await findDevice(t.maker, t.model);
    if (!d) {
      unmatched.push(`${t.maker} ${t.model}`);
      continue;
    }
    const html = await page(d.path ?? `${addressOf(`${d.maker} ${d.name}`)}-${d.id}.php`, `d-${d.id}.html`, 120);
    const sheet = readSheet(html, d.id);
    if (!sheet) {
      unmatched.push(`${t.maker} ${t.model} (page ${d.id} unreadable)`);
      continue;
    }
    file.sheets[t.key] = sheet;
    read++;
    if (read % 20 === 0) console.log(`  ${read} read, ${asked} pages fetched`);
  }
} catch (e) {
  if (!(e instanceof Stop)) throw e;
  console.log(`Stopped: ${e.message}. ${todo.length - read - unmatched.length} models still to look up; run again another day to carry on.`);
}
file.at = new Date().toISOString().slice(0, 10);
file.sheets = Object.fromEntries(Object.entries(file.sheets).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(OUT, JSON.stringify(file, null, 1) + '\n');
console.log(`Saved ${Object.keys(file.sheets).length} sheets (${read} new) after ${asked} page requests`);
if (unmatched.length) console.log(`No exact match for ${unmatched.length}:\n  ${unmatched.join('\n  ')}`);
