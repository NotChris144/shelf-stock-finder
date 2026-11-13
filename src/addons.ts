// Add-ons: what else on the shelf goes with the item a customer is buying.
//
// Each kind of product has a short list of slots, in the order they are worth offering: for a
// console a second controller, then games, a headset and a way to charge the controllers. A slot
// names the CeX categories to look in and how to tell whether an accessory fits this item, worked
// out from the two names and the item's spec sheet. Some examples:
//   - a PS5 Slim needs the Slim stand;
//   - a Switch 2 only takes microSD Express cards;
//   - a strap for a 45mm Apple Watch must be one of the large ones;
//   - a body-only Canon DSLR takes EF and EF-S lenses but not RF.
// An accessory that might fit but can't be confirmed from its name is offered as "check it fits".
// One that can't fit is left out.
//
// The stock is the branch's own, read when the screen opens, so every suggestion is on the shelf.
// Each slot offers up to three: the one most popular on CeX, the cheapest, and one at the top end,
// so there is an easy yes and a step up.

import type { Item } from './types.ts';

export type Fit = 'yes' | 'check' | 'no';

export interface Slot {
  id: string;
  title: string;
  /** One line on why it goes with the item, plain enough to read to the customer. */
  why: string;
  cats: string[];
  /** An accessory's name must match this... */
  has?: RegExp;
  /** ...and must not match this. */
  not?: RegExp;
  /** Whether an accessory fits this item (default: it does). */
  fit?: (a: Item) => Fit;
  /** Ranked by popularity alone: the best sellers first. */
  games?: true;
  /** Cheapest worth offering; less is a giveaway rather than an add-on. */
  floor?: number;
  /** Dearest worth offering (default: the item's own price). */
  cap?: number;
  /** Among equals, these go first (the item's own maker: AirPods with an iPhone). */
  prefer?: RegExp;
}

export interface Offer {
  item: Item;
  fit: Fit;
  /** Why this one was picked: most popular, cheapest or top end. */
  tag: string;
}

export interface Shelf {
  slot: Slot;
  /** The two or three picked to show. */
  offers: Offer[];
  /** Everything else that fits, cheapest first. */
  rest: Offer[];
}

// ------------------------------------------------------------------ names

const watts = (s: string): number => Math.max(0, ...[...s.matchAll(/(\d+(?:\.\d+)?)\s*W\b/gi)].map((m) => Number(m[1])));
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Words that make a model a different one: "15" is not "15 Pro", "S9" is not "S9 FE". */
const VARIANT = /^\s*(pro|max|plus|ultra|mini|fe|lite|edge|neo|classic|e\b|\d)/i;

/**
 * Whether an accessory's name calls out this exact model: "Case for iPhone 15 Pro", "iPhone X/XS
 * case", "Samsung Galaxy S9+ Case". The family word (iPhone, Galaxy, Pixel) must appear too.
 */
export function namesModel(acc: string, model: string): boolean {
  const m = model.replace(/\b5G\b|\bLTE\b/gi, '').replace(/\s+/g, ' ').trim();
  const fam = m.match(/^(iphone|galaxy|pixel|moto|nord|redmi|xperia)\s+(.+)$/i);
  const core = fam ? fam[2] : m;
  if (!core) return false;
  const a = ` ${acc.replace(/\+/g, ' Plus').replace(/\s+/g, ' ')} `;
  if (fam && !new RegExp(fam[1].toLowerCase() === 'galaxy' ? 'galaxy|samsung' : fam[1], 'i').test(a)) return false;
  for (const x of a.matchAll(new RegExp(`[\\s/]${escRe(core)}(?=[^a-z0-9])`, 'gi'))) {
    if (!VARIANT.test(a.slice(x.index + x[0].length))) return true;
  }
  return false;
}

/** The number in an iPhone's name ("iPhone 15 Pro" → 15; X/XS/XR count as 10, the SE models as 8 or 11). */
function iphoneNo(it: Item): number {
  const m = it.model;
  if (/\bSE\b/i.test(m)) return /3rd/i.test(m) ? 13 : /2nd/i.test(m) ? 11 : 6;
  if (/\bX[SR]?\b/i.test(m)) return 10;
  if (/\bair\b/i.test(m)) return 17;
  return Number(m.match(/iPhone (\d+)/i)?.[1] ?? 0);
}

const isApple = (it: Item): boolean => /apple/i.test(it.brand) || /^(iphone|ipad|macbook|imac|mac )/i.test(it.name.replace(/^apple /i, ''));
const isSamsung = (it: Item): boolean => /samsung/i.test(it.brand) || /galaxy/i.test(it.name);
const isGoogle = (it: Item): boolean => /google/i.test(it.brand) || /pixel/i.test(it.model);

type Port = 'usbc' | 'lightning' | 'micro';

/** The phone's or tablet's charging port, and whether that is known rather than assumed. */
function portOf(it: Item): { port: Port; sure: boolean } {
  if (it.kind === 'phone' && isApple(it)) return { port: iphoneNo(it) >= 15 ? 'usbc' : 'lightning', sure: true };
  if (it.kind === 'tablet' && isApple(it)) {
    const ip = ipadOf(it);
    const usbc = ip.chip !== '' || (ip.fam === 'ipad' && ip.gen >= 10) || (ip.fam === 'mini' && ip.gen >= 6) || (ip.fam === 'air' && ip.gen >= 4) || (ip.fam === 'pro' && it.screen >= 11);
    return { port: usbc ? 'usbc' : 'lightning', sure: ip.gen > 0 || ip.chip !== '' };
  }
  const sh = it.specs?.sheet;
  if (sh) return { port: sh.usbc ? 'usbc' : 'micro', sure: true };
  return { port: 'usbc', sure: false };
}

const portOfName = (s: string): Port | '' => (/lightning/i.test(s) ? 'lightning' : /micro-?\s?usb/i.test(s) ? 'micro' : /usb-?\s?c|type-?c/i.test(s) ? 'usbc' : '');

/** iPhones with the magnets for MagSafe chargers and battery packs: the 12 on, but not the SE or 16e. */
const magsafe = (it: Item): boolean => it.kind === 'phone' && isApple(it) && iphoneNo(it) >= 12 && !/\bSE\b|16e/i.test(it.model);

/** Whether it charges without a cable. */
function wireless(it: Item): boolean {
  if (it.kind === 'phone' && isApple(it)) return iphoneNo(it) >= 8;
  return it.specs?.sheet?.wl !== undefined;
}

/** True when it has no 3.5mm socket, so wired headphones need an adapter. */
function noJack(it: Item): boolean {
  if (isApple(it)) return it.kind === 'phone' ? iphoneNo(it) >= 7 : false;
  const sh = it.specs?.sheet;
  return Boolean(sh && !sh.jack);
}

// ------------------------------------------------------------------ iPads

interface Ipad {
  fam: 'ipad' | 'mini' | 'air' | 'pro' | '';
  gen: number;
  /** "A16", "A17 Pro", "M2"..., '' when the name gives a generation instead. */
  chip: string;
}

export function ipadOf(it: Item): Ipad {
  const m = `${it.model} ${it.name}`;
  const fam = /\bmini\b/i.test(m) ? 'mini' : /\bair\b/i.test(m) ? 'air' : /ipad pro/i.test(m) ? 'pro' : /ipad/i.test(m) ? 'ipad' : '';
  const gen = Number(it.model.match(/(\d+)(?:st|nd|rd|th)\s*gen/i)?.[1] ?? 0);
  const chip = m.match(/\b(A1[5-9](?: Pro)?|M[1-9])\b/)?.[1] ?? '';
  return { fam, gen, chip };
}

type Pencil = '1' | '2' | 'usbc' | 'pro';

const pencilOf = (s: string): Pencil | '' =>
  /pencil pro/i.test(s) ? 'pro' : /usb-?c/i.test(s) && /pencil/i.test(s) ? 'usbc' : /2nd gen|A2051/i.test(s) ? '2' : /A1603|1st gen|lightning/i.test(s) ? '1' : '';

/** Which Apple Pencils an iPad works with, from Apple's own compatibility lists. */
export function pencilFit(it: Item, p: Pencil | ''): Fit {
  const { fam, gen, chip } = ipadOf(it);
  if (!p || !fam || (!gen && !chip && fam !== 'pro')) return 'check';
  const size = it.screen;
  const m = /^M(\d)/.exec(chip);
  const mn = m ? Number(m[1]) : 0;
  const ok = new Set<Pencil>();
  const maybe = new Set<Pencil>();
  if (fam === 'ipad') {
    // The A16 and the 10th generation take the USB-C Pencil, and the first one with an adapter.
    if (chip === 'A16' || gen >= 10) {
      ok.add('usbc');
      maybe.add('1');
    } else if (gen >= 6) ok.add('1');
  } else if (fam === 'mini') {
    if (chip.startsWith('A17') || gen >= 7) ['usbc', 'pro'].forEach((x) => ok.add(x as Pencil));
    else if (gen === 6) ['2', 'usbc'].forEach((x) => ok.add(x as Pencil));
    else if (gen === 5) ok.add('1');
  } else if (fam === 'air') {
    if (mn >= 2 || gen >= 6) ['usbc', 'pro'].forEach((x) => ok.add(x as Pencil));
    else if (gen >= 4) ['2', 'usbc'].forEach((x) => ok.add(x as Pencil));
    else if (gen === 3) ok.add('1');
  } else {
    if (mn >= 4) ['usbc', 'pro'].forEach((x) => ok.add(x as Pencil));
    else if ((size >= 10.9 && size < 12) || (size >= 12.9 && gen >= 3)) ['2', 'usbc'].forEach((x) => ok.add(x as Pencil));
    else if (size > 0) ok.add('1');
    else return 'check';
  }
  return ok.has(p) ? 'yes' : maybe.has(p) ? 'check' : 'no';
}

/**
 * Whether an iPad case or keyboard names this iPad: the same family (mini, Air, Pro or plain),
 * a size that matches, and the same generation or chip when it gives one. A name such as
 * "11" iPad Pro 1st/2nd/3rd Gen & Air 4th" covers each family it lists.
 */
export function ipadAccFit(it: Item, acc: string): Fit {
  const ip = ipadOf(it);
  if (!ip.fam) return 'no';
  const size = Number(acc.match(/(\d{1,2}(?:\.\d)?)\s*(?:"|''|”|-?\s?inch)/i)?.[1] ?? 0);
  if (size && it.screen && Math.abs(size - it.screen) > 0.4) return 'no';
  let best: Fit = 'no';
  for (const part of acc.split(/&| and /i)) {
    const fam = /\bmini\b/i.test(part) ? 'mini' : /\bair\b/i.test(part) ? 'air' : /\bpro\b/i.test(part) && !/a17 pro/i.test(part) ? 'pro' : /ipad/i.test(part) ? 'ipad' : '';
    if (fam !== ip.fam) continue;
    const gens = [...part.matchAll(/(\d+)(?:st|nd|rd|th)/gi)].map((x) => Number(x[1]));
    const chips = [...part.matchAll(/\b(A1[5-9](?: Pro)?|M[1-9])\b/g)].map((x) => x[1]);
    if (!gens.length && !chips.length) best = best === 'yes' ? 'yes' : 'check';
    else if ((ip.gen && gens.includes(ip.gen)) || (ip.chip && chips.includes(ip.chip))) return 'yes';
    // The A16 and the 10th generation share a body, so a case for one is worth a look for the other.
    else if (ip.fam === 'ipad' && (ip.chip === 'A16' || ip.gen === 10) && (gens.includes(10) || chips.includes('A16'))) best = 'check';
  }
  return best;
}

// ------------------------------------------------------------------ Galaxy tablets and watches

/**
 * Samsung's series names: "Tab S9/S10 Series" covers the S9 and S10 and their Plus and Ultra,
 * and is worth a check for the FE and Lite; "S11/S12 Ultra" covers only the Ultras.
 */
export function seriesFit(acc: string, model: string): Fit {
  const im = model.match(/\bS(\d+)\s*(fe|lite|ultra|plus|\+)?/i);
  if (!im) return 'no';
  const n = Number(im[1]);
  const suffix = (im[2] ?? '').toLowerCase().replace('+', 'plus');
  const am = acc.match(/\bS(\d+)((?:\s*\/\s*S?\d+)*)\s*(fe|lite|ultra|plus|\+)?/i);
  if (!am) return 'no';
  const nums = [Number(am[1]), ...[...am[2].matchAll(/(\d+)/g)].map((x) => Number(x[1]))];
  const asuffix = (am[3] ?? '').toLowerCase().replace('+', 'plus');
  if (!nums.includes(n)) return 'no';
  if (asuffix === suffix) return 'yes';
  if (!asuffix) return suffix === 'fe' || suffix === 'lite' ? 'check' : 'yes';
  return 'no';
}

/** The size of an Apple Watch case or band in mm, and which band group it takes. */
function watchMm(s: string): number[] {
  return [...s.matchAll(/(\d{2})\s*mm/gi)].map((x) => Number(x[1]));
}

/**
 * Apple Watch bands come in two groups: small (38, 40, 41mm, and the 42mm of the Series 10 and
 * later) and large (the old 42mm, 44, 45, 46, 49mm). A band fits any watch in its group.
 */
export function strapFit(watch: string, band: string): Fit {
  const w = watchMm(watch)[0];
  if (!w) return 'check';
  const series = Number(watch.match(/series (\d+)/i)?.[1] ?? 0);
  const small = (mm: number, newer: boolean): boolean | null => (mm <= 41 ? true : mm >= 44 ? false : newer ? true : null);
  const wSmall = small(w, series >= 10 || /\bSE\b.*3rd/i.test(watch));
  const bands = watchMm(band);
  if (!bands.length) return 'check';
  // A 2024-on band called 42mm is the new small size; one listed with 44mm ("42mm/44mm") is the old large one.
  const oldLarge = bands.includes(42) && bands.some((mm) => mm >= 44);
  const bNew = /\(20(2[4-9])\)/.test(band);
  const groups = bands.map((mm) => (mm === 42 && oldLarge ? false : small(mm, bNew)));
  if (wSmall === null || groups.includes(null)) return groups.includes(wSmall) ? 'yes' : 'check';
  return groups.includes(wSmall) ? 'yes' : 'no';
}

/** Galaxy and Pixel watch bands: named for the same watch, or a 20mm band for a Galaxy Watch 4 to 7. */
export function bandFit(watch: string, band: string): Fit {
  if (/pixel/i.test(watch)) {
    if (!/pixel/i.test(band)) return 'no';
    const w = watchMm(watch)[0];
    const b = watchMm(band);
    return !w || !b.length ? 'check' : b.includes(w) ? 'yes' : 'no';
  }
  if (!/galaxy|samsung/i.test(watch) || !/galaxy|samsung/i.test(band)) return 'no';
  const gen = (s: string): string => (/ultra/i.test(s) ? 'ultra' : s.match(/watch\s?(\d)/i)?.[1] ?? '');
  const wg = gen(watch);
  const bg = gen(band);
  if (bg && wg) return bg === wg || (Number(bg) >= 4 && Number(bg) <= 7 && Number(wg) >= 4 && Number(wg) <= 7) ? 'yes' : 'no';
  if (/20\s*mm/i.test(band)) return Number(wg) >= 4 && Number(wg) <= 7 ? 'yes' : 'check';
  return 'check';
}

// ------------------------------------------------------------------ cameras

const BATTERY: [RegExp, string][] = [
  [/EOS (750|760|77|200|250|800|850)D\b|EOS M[356]\b|EOS (RP|R8|R10|R50|R100)\b/i, 'LP-E17'],
  [/EOS (5D Mark (II|III|IV)|6D|7D|60D|70D|80D|90D|R|R5|R6|R7)\b/i, 'LP-E6'],
  [/EOS (550|600|650|700)D\b/i, 'LP-E8'],
  [/EOS (1100|1200|1300|2000|4000)D\b/i, 'LP-E10'],
  [/EOS (400|450|500|1000)D\b/i, 'LP-E5'],
  [/powershot g(5|7|9) ?x/i, 'NB-13L'],
  [/X-T[1-3]\b|X-E[1-4]\b|X-T(10|20|30)\b|X-A\d|X-Pro[12]|X-S10|X100V\b|X100VI/i, 'NP-W126'],
  [/\bG(H3|H4|H5|9)\b|DMC-GH[345]/i, 'BLF19'],
];

const batteryOf = (s: string): string => BATTERY.find(([re]) => re.test(s))?.[1] ?? '';

/** The lens mount a camera body takes, from its name. */
function mountOf(name: string): string {
  if (/canon/i.test(name)) return /EOS R\w*\b|EOS M\d/i.test(name) ? (/EOS M\d/i.test(name) ? 'EF-M' : 'RF') : 'EF';
  if (/nikon/i.test(name)) return /\bZ\s?\d/i.test(name) ? 'Z' : 'F';
  if (/sony/i.test(name)) return /alpha|ilce|nex|a\d{4}|a7/i.test(name) ? 'E' : '';
  if (/fuji/i.test(name)) return /X-[TEAHS]|X-Pro/i.test(name) ? 'X' : '';
  if (/panasonic|olympus|om system/i.test(name)) return /\bG\w*\d|E-M\d|OM-\d/i.test(name) ? 'MFT' : '';
  return '';
}

/** Whether a lens fits a body: its mount from the maker's own lens names, or the "(Canon)" a third-party lens is labelled with. */
export function lensFit(body: string, lens: string): Fit {
  const mount = mountOf(body);
  if (!mount) return 'no';
  const adapter = /adapter|EF-EOS R/i.test(body);
  switch (mount) {
    case 'EF':
      if (/\bRF\b/.test(lens)) return 'no';
      if (/canon EF(-S)?\b|\(canon\)/i.test(lens)) return /EF-S/.test(lens) && /\b(5D|6D|1D)\b/.test(body) ? 'no' : 'yes';
      return 'no';
    case 'RF':
      if (/canon RF\b/i.test(lens)) return 'yes';
      if (/canon EF\b|\(canon\)/i.test(lens)) return adapter ? 'yes' : 'check';
      return 'no';
    case 'F':
      if (!/nikon|\(nikon\)/i.test(lens) || /\bZ\b/.test(lens)) return 'no';
      // Lenses without their own focus motor only focus by hand on the smaller Nikon bodies.
      return /AF-S|AF-P/i.test(lens) ? 'yes' : 'check';
    case 'E':
      if (/sony E\b|\bFE\b|SEL\d/i.test(lens)) return 'yes';
      if (/\(sony\)|for sony/i.test(lens)) return /\bDN\b|NEX|\bE\b/i.test(lens) ? 'yes' : 'check';
      return 'no';
    default:
      return new RegExp(mount === 'X' ? 'fuji' : mount === 'MFT' ? 'panasonic|olympus|lumix|m\\.zuiko' : mount, 'i').test(lens) ? 'check' : 'no';
  }
}

// ------------------------------------------------------------------ consoles

interface Platform {
  /** What CeX calls it in a sentence. */
  label: string;
  /** Words an accessory's name uses for it, as in "(PS5/PS4/PC)". */
  tag: RegExp;
  controllers: string[];
  accessories: string[];
  games: string[];
}

const MULTI = /multi-?\s?platform|multplatform|\(mp\)|\bmp\)/i;

const P: Record<string, Platform> = {
  ps5: { label: 'PS5', tag: /\bPS5\b|playstation ?5/i, controllers: ['Playstation5 Controllers'], accessories: ['Playstation5 Accessories'], games: ['Playstation5 Games'] },
  ps4: { label: 'PS4', tag: /\bPS4\b|playstation ?4/i, controllers: ['Playstation4 Controllers'], accessories: ['Playstation4 Accessories'], games: ['Playstation4 Games'] },
  xs: { label: 'Xbox Series', tag: /\bseries\b|\bxbox\b(?!\s*(one|360))|\bxb\b(?!1)/i, controllers: ['Xbox Series Controllers', 'Xbox One Controllers'], accessories: ['Xbox Series Accessories'], games: ['Xbox Series Games', 'Xbox Smart Delivery Games'] },
  xb1: { label: 'Xbox One', tag: /\bxb1\b|xbox one|\bxbox\b(?!\s*(series|360))|\bxb\b(?!1)/i, controllers: ['Xbox One Controllers', 'Xbox Series Controllers'], accessories: ['Xbox One Accessories'], games: ['Xbox One Games', 'Xbox Smart Delivery Games'] },
};

const HEADSET_CATS = ['Playstation5 Accessories', 'Playstation4 Accessories', 'Xbox Series Accessories', 'Xbox One Accessories', 'PC Headsets'];
const NOT_PAD = /wheel|pedal|hotas|yoke|joystick|flight|arcade|move motion|shifter|stick\b/i;
const WHEEL = /wheel|pedal|hotas|flight stick|yoke/i;

function controllers(p: Platform, why: string): Slot {
  return {
    id: 'pad',
    title: 'A second controller',
    why,
    cats: [...p.controllers, 'PC Gaming Controllers'],
    not: NOT_PAD,
    fit: (a) => (p.controllers.includes(a.category) || p.tag.test(a.name) ? 'yes' : 'no'),
    floor: 15,
  };
}

function headsets(p: Platform): Slot {
  return {
    id: 'headset',
    title: 'A headset',
    why: 'Hear the game properly and talk to friends online.',
    cats: HEADSET_CATS,
    has: /headset|earbuds|recon\b/i,
    not: /adapter|audio controller|stand|mixamp|jabra|plantronics|evolve|voyager|\bVR2?\b/i,
    fit: (a) => (p.accessories.includes(a.category) || p.tag.test(a.name) || MULTI.test(a.name) ? 'yes' : 'no'),
    floor: 12,
  };
}

function games(p: Platform | string[], label: string): Slot {
  return { id: 'games', title: 'Games', why: `The most popular ${label} games we have in.`, cats: Array.isArray(p) ? p : p.games, games: true, cap: 70 };
}

function wheels(p: Platform): Slot {
  return {
    id: 'wheel',
    title: 'A racing wheel',
    why: 'Wheel and pedals for racing games.',
    cats: [...p.accessories, 'Playstation5 Accessories', 'Playstation4 Accessories', 'PC Gaming Controllers'],
    has: WHEEL,
    not: /joy-?con|mario kart|solus/i,
    fit: (a) => (p.tag.test(a.name) ? 'yes' : 'no'),
    floor: 20,
    cap: 400,
  };
}

function ps5(it: Item): Slot[] {
  const n = it.name;
  const slim = /slim/i.test(n);
  const digital = /digital/i.test(n);
  const pro = /\bpro\b/i.test(n);
  // The Pro stands on the Slim's stand.
  const slimStand = slim || pro;
  const slots: Slot[] = [controllers(P.ps5,'For two players, or one to use while the other charges.')];
  // A Digital Edition can't play discs, so boxed games are no use to it without the drive.
  if (!digital) slots.push(games(P.ps5, 'PS5'));
  else if (slim || pro) {
    slots.push({
      id: 'drive',
      title: 'A disc drive',
      why: 'The Digital Edition has no disc drive. This one clips on so it plays discs and films too.',
      cats: ['Playstation5 Accessories'],
      has: /disc drive/i,
      cap: 200,
    });
  }
  slots.push(headsets(P.ps5));
  slots.push({
    id: 'charge',
    title: 'Controller charging',
    why: 'Charges two controllers at once, so one is always ready.',
    cats: ['Playstation5 Accessories'],
    has: /charg/i,
    not: /portal/i,
  });
  slots.push({
    id: 'stand',
    title: 'A stand',
    why: slimStand ? `The PS5 ${pro ? 'Pro' : 'Slim'} doesn’t come with a stand to stand it upright.` : 'Stands it upright, if the one it came with is missing.',
    cats: ['Playstation5 Accessories'],
    has: /stand\b/i,
    not: /charg/i,
    fit: (a) => (/slim/i.test(a.name) === slimStand ? 'yes' : 'no'),
  });
  if (slim) {
    slots.push({ id: 'covers', title: 'New covers', why: 'Swap the white panels for a colour.', cats: ['Playstation5 Accessories'], has: /covers?\b/i, fit: (a) => (/slim/i.test(a.name) ? 'yes' : 'no') });
  }
  slots.push({
    id: 'portal',
    title: 'Play without the TV',
    why: 'The PlayStation Portal streams games from the PS5 over home Wi-Fi, for when the TV is in use.',
    cats: ['Playstation5 Accessories'],
    has: /portal remote player/i,
    cap: 400,
  });
  slots.push(wheels(P.ps5));
  slots.push({ id: 'vr', title: 'Virtual reality', why: 'PS VR2 plugs into the PS5 for VR games.', cats: ['Playstation5 Accessories'], has: /VR2/i, cap: 500 });
  return slots;
}

function xbox(it: Item, p: Platform): Slot[] {
  const digital = /series s\b|digital/i.test(it.name);
  const slots: Slot[] = [controllers(p, 'For two players. Xbox One and Series controllers work on both.')];
  if (!digital) slots.push(games(p, p.label));
  slots.push({
    id: 'battery',
    title: 'Rechargeable batteries',
    why: 'Xbox controllers run on AA batteries. A rechargeable pack saves buying them.',
    cats: ['Gaming Batteries', 'Xbox Series Accessories', 'Xbox One Accessories'],
    has: /battery|play & charge|charging station/i,
  });
  slots.push(headsets(p));
  slots.push(wheels(p));
  return slots;
}

function ps4(): Slot[] {
  return [
    { ...controllers(P.ps4, 'For two players, or one to use while the other charges.'), not: /move motion|wheel|pedal|hotas|arcade|stick\b/i },
    games(P.ps4, 'PS4'),
    headsets(P.ps4),
    { id: 'charge', title: 'Controller charging', why: 'Charges two controllers at once, so one is always ready.', cats: ['Playstation4 Accessories'], has: /charg/i, not: /move/i },
    wheels(P.ps4),
  ];
}

function memoryCard(why: string, fit?: (a: Item) => Fit, floor = 6): Slot {
  return { id: 'memory', title: 'A memory card', why, cats: ['Secure Digital Micro (SD)'], fit, floor };
}

function switch1(it: Item): Slot[] {
  const lite = /lite/i.test(it.name);
  const oled = /oled/i.test(it.name);
  const slots: Slot[] = [];
  if (!lite) {
    slots.push({
      id: 'pad',
      title: 'Another controller',
      why: 'A Pro Controller is easier on the hands for long sessions; extra Joy-Con are for a second player.',
      cats: ['Switch Controllers'],
      // The NES pads are a single retro Joy-Con each, for the online classics: not a second controller.
      not: /nitro deck|NES controller/i,
      floor: 15,
    });
  }
  slots.push(games(['Switch Games'], 'Switch'));
  slots.push(memoryCard(`It holds ${oled ? '64GB' : '32GB'}, which fills after a few downloaded games. A memory card makes room for many more.`, undefined, 8));
  if (!lite) {
    slots.push({ id: 'charge', title: 'Joy-Con charging', why: 'Charges Joy-Con off the console, so a spare pair is always ready.', cats: ['Switch Accessories'], has: /charg/i });
    slots.push({ id: 'dock', title: 'A second dock', why: 'Plays the Switch on a second TV without moving the dock.', cats: ['Switch Accessories'], has: /dock set/i, cap: 100 });
    slots.push({ id: 'grip', title: 'Handheld grip', why: 'A full-size grip for handheld play.', cats: ['Switch Controllers'], has: /nitro deck/i });
  }
  slots.push({
    id: 'charger',
    title: 'A spare charger',
    why: 'One to keep by the bed or in a bag.',
    cats: ['Switch Accessories', 'CeX basics - Gaming Accessories'],
    has: /ac adapter|charger for nintendo switch/i,
  });
  slots.push({ id: 'amiibo', title: 'Amiibo', why: 'Figures that unlock extras in many Nintendo games.', cats: ['Amiibo'], games: true, cap: 60 });
  return slots;
}

function switch2(): Slot[] {
  return [
    { id: 'pad', title: 'Another controller', why: 'A Pro Controller for long sessions, or Joy-Con 2 for a second player.', cats: ['Switch 2 Controllers'], floor: 15 },
    games(['Switch 2 Games', 'Switch Games'], 'Switch 2 and Switch'),
    memoryCard(
      'The Switch 2 only takes microSD Express cards, and its 256GB fills after a few big games.',
      (a) => (/express/i.test(a.name) ? 'yes' : 'no'),
      10,
    ),
    { id: 'charge', title: 'Joy-Con 2 charging', why: 'Charges Joy-Con 2 off the console.', cats: ['Switch 2 Accessories'], has: /charg/i },
    { id: 'dock', title: 'A second dock', why: 'Plays the Switch 2 on a second TV without moving the dock.', cats: ['Switch 2 Accessories'], has: /dock set/i, cap: 150 },
    { id: 'wheel', title: 'Mario Kart wheels', why: 'Joy-Con 2 wheels for Mario Kart.', cats: ['Switch 2 Accessories'], has: /wheel/i },
  ];
}

function handheldPc(it: Item): Slot[] {
  const deck = /steam deck/i.test(it.name);
  return [
    memoryCard('A fast memory card adds room for more games. Look for A2 or V30 on the card.', (a) => (/extreme|A2\b|V30|U3/i.test(a.name) ? 'yes' : 'check'), 12),
    { id: 'dock', title: 'A dock', why: 'Connects it to a TV or monitor, with a keyboard and mouse.', cats: ['PC Accessories'], has: /dock/i, fit: (a) => (/steam deck/i.test(a.name) ? (deck ? 'yes' : 'check') : 'check'), cap: 150 },
    { id: 'charger', title: 'A spare charger', why: 'A 45W USB-C plug or stronger charges it at full speed.', cats: ['CeX basics - Power', 'Phone Accessories'], has: /plug|wall charger/i, fit: (a) => (watts(a.name) >= 45 ? 'yes' : 'no') },
    { id: 'bank', title: 'A power bank', why: 'Games drain the battery fast. A big power bank keeps it going on a trip.', cats: ['Power Banks'], fit: (a) => (watts(a.name) >= 45 || /27,?\d{3}|20,?\d{3}/.test(a.name) ? 'yes' : 'no') },
    { id: 'headset', title: 'A headset', why: 'Wired gaming headsets plug straight into its headphone socket.', cats: ['PC Headsets'], has: /headset/i, fit: (a) => (MULTI.test(a.name) || /wired/i.test(a.name) ? 'yes' : 'no'), not: /jabra|plantronics|evolve/i, floor: 12 },
  ];
}

function ds(it: Item): Slot[] {
  const three = /3DS|2DS/i.test(it.name) || it.category === '3DS Consoles';
  const dsi = /dsi/i.test(it.name);
  return [
    games(three ? ['3DS Games', 'Nintendo DS Games'] : ['Nintendo DS Games'], three ? '3DS and DS' : 'DS'),
    {
      id: 'charger',
      title: 'A charger',
      why: 'A spare charger, or one in case it is needed.',
      cats: ['3DS Accessories', 'Nintendo DS Accessories', 'CeX basics - Gaming Accessories'],
      has: /charg|adaptor|adapter/i,
      fit: (a) => (/3DS|DSi/i.test(a.name) ? (three || dsi ? 'yes' : 'no') : /DS Lite/i.test(a.name) ? (/lite/i.test(it.name) ? 'yes' : 'no') : 'check'),
    },
  ];
}

function vita(): Slot[] {
  return [
    { id: 'memory', title: 'A memory card', why: 'PS Vita games and saves need Sony’s own Vita memory card.', cats: ['PS Vita Accessories'], has: /memory card/i },
    games(['PS Vita Games'], 'PS Vita'),
    { id: 'case', title: 'A case', why: 'Keeps the screen safe in a bag.', cats: ['PS Vita Accessories'], has: /case/i },
  ];
}

/** Older consoles: their own controllers and games. */
const RETRO: Record<string, { label: string; controllers?: string[]; games: string[] }> = {
  'Playstation3 Consoles': { label: 'PS3', controllers: ['Playstation3 Controllers'], games: ['Playstation3 Games'] },
  'Xbox 360 Consoles': { label: 'Xbox 360', controllers: ['Xbox 360 Controllers'], games: ['Xbox 360 Games'] },
  'Wii Consoles': { label: 'Wii', controllers: ['Wii Controllers'], games: ['Wii Games'] },
  'Wii U Consoles': { label: 'Wii U', controllers: ['Wii U Controllers', 'Wii Controllers'], games: ['Wii U Games', 'Wii Games'] },
  'Playstation2 Consoles': { label: 'PS2', controllers: ['Playstation2 Controllers'], games: ['Playstation2 Games'] },
  'Playstation1 Consoles': { label: 'PlayStation', games: ['Playstation1 Games'] },
  'PSP Consoles': { label: 'PSP', games: ['PSP Games'] },
  'GameCube Consoles': { label: 'GameCube', games: ['GameCube Games'] },
  'Mega Drive Consoles': { label: 'Mega Drive', games: ['Mega Drive Software'] },
  'Super NES Consoles': { label: 'Super Nintendo', games: ['Super NES Software'] },
  'Game Boy Consoles': { label: 'Game Boy', games: ['Game Boy Software'] },
  'Game Boy Color Consoles': { label: 'Game Boy Color', games: ['Game Boy Color Software', 'Game Boy Software'] },
  'Gameboy Advance Consoles': { label: 'Game Boy Advance', games: ['Gameboy Advance Software', 'Game Boy Color Software', 'Game Boy Software'] },
  'Master System Consoles': { label: 'Master System', games: ['Master System Software'] },
  'Dreamcast Consoles': { label: 'Dreamcast', games: ['Dreamcast Games'] },
};

// ------------------------------------------------------------------ phones and tablets

const EARBUD_CATS = ['In-ear Headphones', 'Apple AirPods, EarPods & Headphones', 'Open-ear Headphones'];
const PLUG_CATS = ['CeX basics - Power', 'Apple iPhone Accessories', 'Phone Accessories'];

function chargerSlot(it: Item): Slot {
  const sheetW = it.specs?.sheet?.w ?? 0;
  const apple = isApple(it);
  // iPhones from the 8 and recent iPads fast-charge from a USB-C plug of 18W or more; others say how fast on their spec sheet.
  const old = apple && it.kind === 'phone' && iphoneNo(it) < 8;
  const why = old
    ? 'A charging plug to go with it.'
    : apple
      ? 'Charges fastest from a USB-C plug of 20W or more.'
      : sheetW > 15
        ? `Fast-charges at up to ${sheetW}W from a USB-C plug.`
        : 'A USB-C plug to charge it at full speed.';
  return {
    id: 'plug',
    title: 'A fast charger',
    why,
    cats: PLUG_CATS,
    has: /plug|power adapter|wall charger/i,
    not: /watch|kettle|magsafe 2|macbook|surface|5w usb power|30pin/i,
    fit: (a) => {
      const w = watts(a.name);
      if (old) return w >= 5 ? 'yes' : 'check';
      // Fast charging needs USB-C and at least 18W; a small USB-A cube charges slowly.
      if (!/usb-?c|gan|prime/i.test(a.name)) return 'no';
      return w >= 18 ? 'yes' : w ? 'no' : 'check';
    },
    floor: 6,
  };
}

function cableSlot(it: Item): Slot {
  const { port, sure } = portOf(it);
  return {
    id: 'cable',
    title: 'A spare cable',
    why: port === 'lightning' ? 'A spare Lightning cable, or a longer one to reach the sofa.' : 'A spare USB-C cable, or a longer one to reach the sofa.',
    cats: ['CeX basics - Cables', 'Apple iPhone Accessories', 'Phone Accessories'],
    has: /cable/i,
    not: /hdmi|audio|30pin|hub|stereo/i,
    fit: (a) => (portOfName(a.name) === port ? (sure ? 'yes' : 'check') : 'no'),
    floor: 4,
  };
}

function earbudSlot(it: Item): Slot {
  return {
    id: 'earbuds',
    title: 'Wireless earbuds',
    why: noJack(it) ? 'It has no headphone socket, so wireless earbuds are the easy way to listen.' : 'Wireless earbuds to go with it.',
    cats: EARBUD_CATS,
    not: /generic|case only|earpods|wired/i,
    floor: 20,
    prefer: isApple(it) ? /airpods|beats/i : isSamsung(it) ? /galaxy buds/i : isGoogle(it) ? /pixel buds/i : undefined,
  };
}

function caseSlot(it: Item, cats: string[]): Slot | null {
  if (!it.model) return null;
  return {
    id: 'case',
    title: 'A case',
    why: 'Keeps it looking the way it does today.',
    cats,
    has: /case|cover|bumper|folio/i,
    not: /charging case|case only|wireless case/i,
    fit: (a) => (namesModel(a.name, it.model) ? 'yes' : 'no'),
  };
}

function phone(it: Item): Slot[] {
  const apple = isApple(it);
  const sh = it.specs?.sheet;
  const slots: (Slot | null)[] = [caseSlot(it, ['Apple iPhone Accessories', 'CeX basics - Phone Accessories', 'Phone Accessories'])];
  // A card slot matters most on a phone with little storage of its own.
  const memory = sh?.sd ? memoryCard(`Takes a memory card, so photos and videos needn’t fill its ${it.storage || 'storage'}.`, (a) => (/nintendo|switch|express/i.test(a.name) ? 'no' : 'yes')) : null;
  if (memory && it.storageGb && it.storageGb <= 64) slots.push(memory);
  slots.push(chargerSlot(it));
  slots.push(earbudSlot(it));
  slots.push(
    apple
      ? { id: 'watch', title: 'An Apple Watch', why: 'Apple Watch only pairs with an iPhone. CeX sells them without a strap, so add one.', cats: ['Apple Watch'], floor: 40 }
      : { id: 'watch', title: 'A smartwatch', why: 'Notifications and fitness tracking on the wrist. CeX sells most without a strap.', cats: ['Smartwatches'], not: /apple/i, floor: 40, prefer: isSamsung(it) ? /galaxy/i : isGoogle(it) ? /pixel/i : undefined },
  );
  if (wireless(it)) {
    slots.push({
      id: 'wireless',
      title: 'A wireless charger',
      why: magsafe(it) ? 'It charges on a pad or snaps onto a MagSafe charger. No cable to plug in.' : 'It charges on a wireless pad, so there is no cable to plug in.',
      cats: PLUG_CATS,
      has: /wireless|magsafe charger|\bqi\b|pixel stand|pixelsnap|3-in-1/i,
      not: /power bank|battery|earbuds|headphone|watch\)|microphone|mic kit|gimbal|stabili[sz]|printer/i,
      fit: (a) => {
        if (/magsafe/i.test(a.name)) return magsafe(it) ? 'yes' : 'no';
        if (/pixel stand|pixelsnap/i.test(a.name)) return isGoogle(it) ? 'yes' : 'no';
        if (/apple devices|iphone/i.test(a.name)) return apple ? 'yes' : 'no';
        return 'yes';
      },
    });
  }
  slots.push({
    id: 'bank',
    title: 'A power bank',
    why: 'A day out without hunting for a plug.',
    cats: ['Power Banks', 'Batteries'],
    not: /dji|gopro|canon|fujifilm|panasonic|nikon|vision pro|flight/i,
    fit: (a) => {
      if (/magsafe/i.test(a.name)) return !magsafe(it) ? 'no' : /iphone air/i.test(a.name) ? (/\bair\b/i.test(it.model) ? 'yes' : 'no') : 'yes';
      return 'yes';
    },
    floor: 10,
  });
  if (memory && !(it.storageGb && it.storageGb <= 64)) slots.push(memory);
  slots.push(cableSlot(it));
  if (apple || isSamsung(it)) {
    slots.push({
      id: 'tag',
      title: apple ? 'An AirTag' : 'A SmartTag',
      why: apple ? 'Finds keys and bags through the iPhone’s Find My app.' : 'Finds keys and bags through the Galaxy phone.',
      cats: ['Apple iPhone Accessories', 'Phone Accessories'],
      has: apple ? /airtag/i : /smarttag/i,
    });
  }
  return slots.filter((s): s is Slot => s !== null);
}

function tablet(it: Item): Slot[] {
  const apple = isApple(it);
  const sh = it.specs?.sheet;
  const noPen = /no pen/i.test(it.name);
  const slots: (Slot | null)[] = [];
  if (apple) {
    slots.push({ id: 'pencil', title: 'An Apple Pencil', why: 'For notes, drawing and marking up. Not every Pencil works with every iPad.', cats: ['Apple iPad Accessories'], has: /pencil/i, fit: (a) => pencilFit(it, pencilOf(a.name)) });
    slots.push({ id: 'keyboard', title: 'A keyboard or case', why: 'A keyboard case turns it into something to type on, and protects it in a bag.', cats: ['Apple iPad Accessories'], has: /keyboard|folio|case|cover/i, fit: (a) => ipadAccFit(it, a.name), cap: 300 });
  } else {
    const samsung = isSamsung(it);
    slots.push({
      id: 'pen',
      title: samsung ? 'An S Pen' : 'A stylus',
      why: noPen ? 'It comes without its pen, which is half the point of it.' : 'For notes and drawing.',
      cats: ['Tablet Accessories'],
      has: /s-?\s?pen|stylus|pen\b/i,
      not: /marker|remarkable|neolab|recorder/i,
      fit: (a) => (samsung ? (/samsung|galaxy/i.test(a.name) ? seriesFit(a.name, it.model) : 'no') : new RegExp(escRe(it.brand), 'i').test(a.name) ? (namesModel(a.name, it.model) ? 'yes' : 'check') : 'no'),
    });
    slots.push({
      id: 'keyboard',
      title: 'A keyboard or case',
      why: 'Protects it in a bag, and a keyboard makes typing easy.',
      cats: ['Tablet Accessories'],
      has: /keyboard|case|cover|folio/i,
      not: /remarkable|boox/i,
      fit: (a) => (new RegExp(escRe(it.brand), 'i').test(a.name) && namesModel(a.name, it.model) ? 'yes' : 'no'),
    });
    if (sh?.sd || /amazon|fire/i.test(it.brand + it.name)) slots.push(memoryCard('Takes a memory card for films, photos and downloads.', (a) => (/nintendo|switch|express/i.test(a.name) ? 'no' : 'yes')));
  }
  slots.push(chargerSlot(it));
  slots.push(earbudSlot(it));
  slots.push(cableSlot(it));
  return slots.filter((s): s is Slot => s !== null);
}

// ------------------------------------------------------------------ computers

/** Macs with USB-C, by model identifier: MacBook Air 8 on, MacBook Pro 13 on, MacBook 8 on. */
function macUsbc(it: Item): boolean | null {
  const m = it.model.match(/macbook (air|pro)? ?(\d+),/i);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1]?.toLowerCase() === 'air' ? n >= 8 : m[1]?.toLowerCase() === 'pro' ? n >= 13 : n >= 8;
}

function computer(it: Item): Slot[] {
  const mac = it.os === 'macOS' || isApple(it);
  const laptop = it.kind === 'laptop';
  const allInOne = it.screen > 0 && !laptop ? true : /imac|all-in-one|\baio\b/i.test(it.name);
  const gamer = it.gpu;
  const slots: Slot[] = [];
  if (!laptop && !allInOne) slots.push({ id: 'monitor', title: 'A screen', why: 'A desktop needs a screen of its own.', cats: ['PC Monitors'], floor: 30, cap: 400, prefer: gamer ? /gaming|144|165|180/i : undefined });
  slots.push({
    id: 'mouse',
    title: 'A mouse',
    why: laptop ? 'Easier than the trackpad for long sessions.' : 'A mouse to go with it.',
    cats: ['PC Mice'],
    not: mac ? undefined : /apple|magic/i,
    floor: 8,
    prefer: mac ? /apple|magic/i : gamer ? /gaming|razer|logitech g|steelseries/i : undefined,
  });
  if (!laptop) slots.push({ id: 'keyboard', title: 'A keyboard', why: 'A keyboard to go with it.', cats: ['PC Keyboards'], floor: 8, not: mac ? undefined : /apple/i });
  if (laptop) slots.push({ id: 'monitor', title: 'A second screen', why: 'Plugged in at a desk, it gives far more room to work.', cats: ['PC Monitors'], floor: 30, cap: 300 });
  if (laptop) {
    const usbc = mac ? macUsbc(it) : null;
    if (usbc !== false) {
      slots.push({
        id: 'hub',
        title: 'A USB-C hub',
        why: 'Adds the ports a slim laptop leaves out: USB, HDMI and a card reader.',
        cats: ['CeX basics - Cables', 'PC Accessories'],
        has: /hub|dock/i,
        not: /steam deck/i,
        fit: () => (usbc ? 'yes' : 'check'),
        cap: 120,
      });
    }
  }
  slots.push({ id: 'headset', title: gamer ? 'A gaming headset' : 'A headset', why: gamer ? 'Hear footsteps and talk to friends online.' : 'For video calls and music.', cats: ['PC Headsets'], has: /headset|headphone|earbuds/i, floor: 12 });
  if (!laptop) slots.push({ id: 'webcam', title: 'A webcam', why: 'Desktops have no camera for video calls.', cats: ['PC Accessories'], has: /webcam|facecam/i, floor: 5 });
  slots.push({ id: 'usb', title: 'A USB stick', why: 'For moving files and keeping a backup.', cats: ['USB Flash Drives'], floor: 5 });
  return slots;
}

// ------------------------------------------------------------------ watches, cameras, drones

function watch(it: Item): Slot[] {
  const apple = it.category === 'Apple Watch' || /apple watch|^watch (series|ultra|se)/i.test(it.name);
  const noStrap = /no strap/i.test(it.name);
  const slots: Slot[] = [
    {
      id: 'strap',
      title: noStrap ? 'A strap' : 'A second strap',
      why: noStrap ? 'It’s sold without a strap, so it needs one to wear.' : 'One for the gym and one for going out.',
      cats: apple ? ['Apple Watch Accessories'] : ['Wearables Accessories'],
      has: /strap|band|loop|bracelet/i,
      fit: (a) => (apple ? strapFit(it.name, a.name) : bandFit(it.name, a.name)),
      floor: 4,
    },
  ];
  if (apple) slots.push({ id: 'charger', title: 'A spare charger', why: 'One to keep at work or in a bag.', cats: ['CeX basics - Power'], has: /watch/i });
  return slots;
}

function camera(it: Item): Slot[] {
  const n = it.name;
  const body = /body only/i.test(n);
  const interchangeable = it.category === 'Digital SLR Cameras' || it.category === 'Cameras - Compact System';
  const instant = /instax|polaroid|instant/i.test(n);
  if (instant) return [];
  const battery = batteryOf(n);
  // A few older professional bodies take CompactFlash, not SD.
  const cf = /\b(D200|D300|D700|D2\w*|D3\b|5D\b|7D\b|40D|50D)\b/.test(n);
  const slots: Slot[] = [];
  if (interchangeable) {
    // A kit sold with its lens ("+ 18-55mm") shouldn't be offered the same lens again.
    const kit = n.match(/\+\s*(\d+)\s*mm?\s*-\s*(\d+)/i) ?? n.match(/\+\s*(\d+)\s*-\s*(\d+)\s*mm/i);
    const same = kit ? new RegExp(`\\b${kit[1]}\\s*(mm)?\\s*-\\s*${kit[2]}\\s*mm`, 'i') : null;
    slots.push({
      id: 'lens',
      title: body ? 'A lens' : 'A second lens',
      why: body ? 'It’s sold as the body only, so it needs a lens to take pictures.' : 'A longer zoom for distance, or a fixed lens for portraits with a blurred background.',
      cats: ['Camera Lenses'],
      fit: (a) => (same?.test(a.name) ? 'no' : lensFit(n, a.name)),
      cap: Math.max(it.price, 400),
    });
  }
  if (!cf) slots.push({ id: 'memory', title: 'A memory card', why: 'Fast SD cards keep up with bursts of photos and video.', cats: ['Secure Digital (SD)'], floor: 8 });
  slots.push({
    id: 'battery',
    title: 'A spare battery',
    why: 'A second battery doubles a day of shooting.',
    cats: ['Batteries'],
    has: /canon|nikon|fuji|panasonic|sony|olympus/i,
    fit: (a) => {
      const code = a.name.match(/\b(LP-E\d+N?|NB-\d+L|NP-\w+|BLF19E?|EN-EL\d+\w?)\b/i)?.[1]?.toUpperCase().replace(/N$/, '') ?? '';
      if (battery && code) return code.startsWith(battery.toUpperCase()) ? 'yes' : 'no';
      return it.brand && new RegExp(escRe(it.brand), 'i').test(a.name) ? 'check' : 'no';
    },
  });
  if (interchangeable) {
    slots.push({
      id: 'flash',
      title: 'A flash',
      why: 'Brighter, softer light indoors than the built-in flash.',
      cats: ['Camera Accessories'],
      has: /flash|speedlite/i,
      not: /trigger|light\b/i,
      fit: (a) => (/canon|speedlite/i.test(a.name) ? (/canon/i.test(n) ? 'yes' : 'no') : /nikon/i.test(a.name) ? (/nikon/i.test(n) ? 'yes' : 'no') : 'check'),
    });
  }
  return slots;
}

function actionCam(it: Item): Slot[] {
  const n = it.name;
  const gopro = /gopro/i.test(n);
  const insta = /insta360/i.test(n);
  const hero = Number(n.match(/hero\s?(\d+)/i)?.[1] ?? 0);
  const slots: Slot[] = [memoryCard('It records to a microSD card. A fast one (U3 or V30) keeps up with 4K video.', (a) => (/U3|V30|extreme|pro/i.test(a.name) ? 'yes' : 'check'), 8)];
  if (gopro || insta) {
    slots.push({
      id: 'battery',
      title: 'Spare batteries',
      why: 'Action cameras get through a battery in about an hour of filming.',
      cats: ['Batteries'],
      has: gopro ? /gopro/i : /insta360/i,
      fit: (a) => {
        if (/AADBD/i.test(a.name)) return hero >= 5 && hero <= 8 ? 'yes' : 'no';
        const heroes = [...a.name.matchAll(/hero\s?(\d+)/gi)].map((x) => Number(x[1]));
        if (heroes.length) return heroes.includes(hero) ? 'yes' : 'no';
        if (/\bmax\b/i.test(a.name)) return /\bmax\b/i.test(n) ? 'yes' : 'no';
        return 'check';
      },
    });
    slots.push({
      id: 'mount',
      title: 'Mounts',
      why: 'Mounts for the head, bike or a selfie stick, for shots a hand can’t get.',
      cats: ['Camera Accessories'],
      has: gopro ? /gopro/i : /insta360/i,
      not: /battery/i,
      fit: (a) => {
        const models = a.name.match(/for (.+?)(?:\s+-|$)/i)?.[1];
        if (!models || !insta) return 'yes';
        const it2 = n.match(/\b(X\d|ONE R\w*)\b/i)?.[1] ?? '';
        return it2 && new RegExp(escRe(it2.replace(/S$/i, '')), 'i').test(models) ? 'yes' : 'check';
      },
    });
  }
  // GoPros and Insta360s need their own adapters for a microphone, and a dash cam has no use for one.
  if (!gopro && !insta && !/dash ?cam/i.test(n)) {
    slots.push({ id: 'mic', title: 'A microphone', why: 'Clearer sound for talking to camera.', cats: ['Camera Accessories'], has: /microphone|wireless go/i, fit: () => 'check' });
  }
  return slots;
}

function drone(it: Item): Slot[] {
  const n = it.name;
  const dji = /dji/i.test(n);
  const model = n.match(/\b(Mini \d(?: Pro)?|Neo|Avata \d?|Air \d\w?|Mavic \w+)\b/i)?.[1] ?? '';
  const fitsModel = (a: Item): Fit => {
    if (!dji || !/dji/i.test(a.name)) return 'no';
    const list = a.name.match(/\b((?:Mini|Neo|Avata|Air|Mavic)[\w\s/]*?)(?:\s+(?:Intelligent|Two-Way|Shoulder|Charging)|\s*\()/i)?.[1] ?? '';
    if (!model || !list) return 'check';
    const fam = model.split(' ')[0].toLowerCase();
    if (!list.toLowerCase().includes(fam)) return 'no';
    const num = model.match(/\d/)?.[0];
    return !num ? 'yes' : list.includes(num) && (/pro/i.test(model) === /pro/i.test(list) || /\//.test(list)) ? 'yes' : list.match(/\d/) ? 'no' : 'yes';
  };
  return [
    { id: 'battery', title: 'Spare batteries', why: 'One battery gives about half an hour in the air. Spares mean a longer flight.', cats: ['Batteries'], has: /flight battery/i, fit: fitsModel, cap: 200 },
    memoryCard('It records to a microSD card. A fast one (U3 or V30) keeps up with 4K video.', (a) => (/U3|V30|extreme|pro/i.test(a.name) ? 'yes' : 'check'), 8),
    { id: 'bag', title: 'A bag and charging', why: 'A bag to carry it, and a hub to charge batteries in turn.', cats: ['Drones Accessories'], fit: fitsModel },
  ];
}

// ------------------------------------------------------------------ choosing

/** The slots worth offering with this item, best first. Empty when it has none. */
export function slotsFor(it: Item): Slot[] {
  const c = it.category;
  switch (c) {
    case 'Playstation5 Consoles':
      return ps5(it);
    case 'Playstation4 Consoles':
      return ps4();
    case 'Xbox Series Consoles':
      return xbox(it, P.xs);
    case 'Xbox One Consoles':
      return xbox(it, P.xb1);
    case 'Switch Consoles':
      return switch1(it);
    case 'Switch 2 Consoles':
      return switch2();
    case 'Handheld Gaming PCs':
      return handheldPc(it);
    case '3DS Consoles':
    case 'Nintendo DS Consoles':
      return ds(it);
    case 'PS Vita Consoles':
      return vita();
    case 'Apple Watch':
    case 'Smartwatches':
      return watch(it);
    case 'Digital SLR Cameras':
    case 'Cameras - Compact System':
    case 'Compact Cameras':
      return camera(it);
    case 'Camcorders':
      return actionCam(it);
    case 'Drones':
      return drone(it);
  }
  const old = RETRO[c];
  if (old) {
    const slots: Slot[] = [];
    if (old.controllers) slots.push({ id: 'pad', title: 'A second controller', why: 'For two players.', cats: old.controllers, not: NOT_PAD, floor: 5 });
    slots.push(games(old.games, old.label));
    return slots;
  }
  if (it.kind === 'phone') return phone(it);
  if (it.kind === 'tablet') return tablet(it);
  if (it.kind === 'laptop' || it.kind === 'desktop') return computer(it);
  return [];
}

/**
 * What to ask CeX for: every category the slots look in, and, for each slot ranked by popularity
 * (games, amiibo), its own short list, so one big category cannot crowd out another.
 */
export function categoriesFor(slots: Slot[]): { cats: string[]; ranked: string[][] } {
  const cats = new Set<string>();
  const ranked: string[][] = [];
  for (const s of slots) {
    if (s.games) ranked.push(s.cats);
    else for (const c of s.cats) cats.add(c);
  }
  return { cats: [...cats], ranked };
}

const ROLE = { pop: 'Most popular', cheap: 'Cheapest', top: 'Top end' };

/**
 * Fill each slot from the branch's stock. `stock` is in CeX's popularity order (its `idx`).
 * A slot with nothing that fits is left out.
 */
export function arrange(it: Item, slots: Slot[], stock: Item[]): Shelf[] {
  const out: Shelf[] = [];
  const seen = new Set<string>([it.id]);
  for (const slot of slots) {
    const fitted: Offer[] = [];
    for (const a of stock) {
      if (seen.has(a.id) || !slot.cats.includes(a.category)) continue;
      if ((slot.has && !slot.has.test(a.name)) || slot.not?.test(a.name) || /^generic\b/i.test(a.name)) continue;
      const fit = slot.fit ? slot.fit(a) : 'yes';
      if (fit !== 'no') fitted.push({ item: a, fit, tag: '' });
    }
    if (!fitted.length) continue;
    // An add-on costs less than the thing it goes with: by default up to 60% of its price.
    const cap = slot.cap ?? Math.max(25, Math.round(it.price * 0.6));
    if (slot.games) {
      const list = fitted.filter((o) => o.item.price <= cap).sort((a, b) => a.item.idx - b.item.idx);
      if (!list.length) continue;
      // The heading already says these are the best sellers, so they carry no tag of their own.
      const offers = list.slice(0, 4);
      out.push({ slot, offers, rest: list.slice(4) });
      for (const o of offers) seen.add(o.item.id);
      continue;
    }
    let pool = fitted.filter((o) => o.item.price >= (slot.floor ?? 0) && o.item.price <= cap);
    if (!pool.length) pool = fitted.filter((o) => o.item.price <= cap);
    if (!pool.length) continue;
    // Confirmed fits are offered ahead of ones to check, whenever there are any.
    const sure = pool.filter((o) => o.fit === 'yes');
    let base = sure.length ? sure : pool;
    // With two or more from the item's own maker (AirPods for an iPhone), every pick is one of them.
    const preferred = slot.prefer ? base.filter((o) => slot.prefer!.test(o.item.name)) : [];
    if (preferred.length >= 2) base = preferred;
    const popular = [...(preferred.length ? preferred : base)].sort((a, b) => a.item.idx - b.item.idx)[0];
    const byPrice = [...base].sort((a, b) => a.item.price - b.item.price || a.item.idx - b.item.idx);
    const cheapest = byPrice[0];
    // The top end is the best seller among the dearest third, not the single dearest: a popular
    // premium choice (an Edge controller), not a collector's edition at four times the price.
    const upper = byPrice.slice(Math.floor((byPrice.length * 2) / 3));
    const top = [...upper].sort((a, b) => a.item.idx - b.item.idx)[0];
    const picks: Offer[] = [];
    const add = (o: Offer, tag: string): void => {
      const had = picks.find((p) => p.item.id === o.item.id);
      if (!had) picks.push({ ...o, tag });
    };
    add(popular, ROLE.pop);
    add(cheapest, ROLE.cheap);
    // A top-end pick only when it is a real step up from the cheapest, not a few pounds more.
    if (top.item.price >= cheapest.item.price * 1.5 && top.item.price - cheapest.item.price >= 10) add(top, ROLE.top);
    picks.sort((a, b) => a.item.price - b.item.price);
    const ids = new Set(picks.map((p) => p.item.id));
    const rest = pool.filter((o) => !ids.has(o.item.id)).sort((a, b) => (a.fit === b.fit ? 0 : a.fit === 'yes' ? -1 : 1) || a.item.price - b.item.price);
    out.push({ slot, offers: picks, rest });
    for (const p of picks) seen.add(p.item.id);
  }
  return out;
}
