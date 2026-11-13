// Turns a raw CeX search record into a structured Item by reading its name.
//
// CeX names follow two shapes:
//   phones/tablets  "Samsung Galaxy A17 5G Dual Sim (4GB+128GB) Black, Unlocked B"
//   computers       "Lenovo ThinkPad T480/i5-8250U/8GB Ram/256GB SSD/14"/W11/B"

import { perfFor } from './perf.ts';
import { specsFor } from './specs.ts';
import { supportFor, type SupportCtx } from './support.ts';
import type { Hit, Item, Kind } from './types.ts';

const BRANDS = [
  'Apple', 'Samsung', 'Google', 'Motorola', 'Nokia', 'Honor', 'Huawei', 'Redmi', 'Oppo', 'OnePlus', 'Xiaomi', 'Sony',
  'Nothing', 'CMF', 'Doro', 'TCL', 'Lenovo', 'POCO', 'Alcatel', 'Doogee', 'ZTE', 'Oukitel', 'Blackview', 'Microsoft',
  'Realme', 'HMD', 'Asus', 'Ulefone', 'Fairphone', 'LG', 'HTC', 'Vivo', 'Acer', 'HP', 'Dell', 'MSI', 'Razer', 'Toshiba',
  'Fujitsu', 'Medion', 'Amazon', 'Gigabyte', 'Alienware', 'Dynabook', 'Framework',
];
const BRAND_RE = new RegExp(`^(${BRANDS.join('|')})\\b\\s*`, 'i');
const CPU_RE = /\b(i[3579]-?\s?\d{3,5}|ryzen|celeron|cel|pentium|pent|atom|athlon|xeon|ultra\s*[579]|m[357]-\d|m[1-5]\b|a\d{1,2}-\d{4}|n\d{2,4}\b|j\d{4}|snapdragon|sd x|x1[ep]?-\d|sq[123]|e[12]-\d{4})|^\d{4}[uy]?$/i;

/** "128GB" → 128, "1TB SSD" → 1024, "" → 0 */
const toGb = (s: string): number => {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(GB|TB)/i);
  return m ? Number(m[1]) * (m[2].toUpperCase() === 'TB' ? 1024 : 1) : 0;
};

const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : v == null ? '' : String(v));

export function kindOf(category: string, name: string): Kind {
  if (/accessor|cases?\b|chargers?|cables?|batter|styl|keyboards?\b/i.test(category)) return 'other';
  if (/iphone|android phones|windows phones|unlocked phones/i.test(category)) return 'phone';
  if (/ipad|^tablets/i.test(category)) return 'tablet';
  if (/laptops|chromebook/i.test(category)) return 'laptop';
  if (/desktops/i.test(category)) return 'desktop';
  // Category missing or unfamiliar: fall back to the computer naming shape.
  if (name.split('/').length >= 4 && CPU_RE.test(name)) return /\d{2}(\.\d)?\s*"/.test(name) ? 'laptop' : 'desktop';
  return 'other';
}

interface Parsed {
  model: string;
  storage: string;
  ram: string;
  cpu: string;
  os: string;
  grade: string;
  variant: string;
  sub: string;
}

function parseMobile(name: string): Parsed {
  const comma = name.lastIndexOf(',');
  let head = comma >= 0 ? name.slice(0, comma) : name;
  const tail = comma >= 0 ? name.slice(comma + 1).trim() : '';
  const gm = tail.match(/^(.*?)\s*\b([ABC])$/);
  let network = gm ? gm[1].trim() : tail;
  const grade = gm ? gm[2] : '';
  head = head.replace(BRAND_RE, '');

  let ram = '';
  let storage = '';
  let cut = head.length;
  let after = '';
  const combo = head.match(/\(?\s*(\d+)\s*GB\s*\+\s*(\d+)\s*(GB|TB)\s*\)?/i);
  const single = combo ? null : head.match(/\b(\d+(?:\.\d+)?)\s*(GB|TB)\b/i);
  if (combo) {
    ram = `${combo[1]}GB`;
    storage = `${combo[2]}${combo[3].toUpperCase()}`;
    cut = combo.index!;
    after = head.slice(cut + combo[0].length);
  } else if (single) {
    storage = `${single[1]}${single[2].toUpperCase()}`;
    cut = single.index!;
    after = head.slice(cut + single[0].length);
  }
  const tidy = (s: string): string =>
    s
      .replace(/\bdual\s*sim\b/gi, ' ')
      .replace(/\((?:A\d{4}|SM-[\w-]+)\)/gi, ' ')
      .replace(/\bSM-[\w-]+/gi, ' ')
      .replace(/\d+(?:\.\d+)?\s*(?:"|''|”|inch\b)/gi, ' ')
      .replace(/\(no pen\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–(]+|[\s\-–(]+$/g, '');
  const model = tidy(head.slice(0, cut));
  let colour = tidy(after);
  if (/\bunlocked$/i.test(colour)) {
    colour = colour.replace(/\s*unlocked$/i, '');
    network ||= 'Unlocked';
  }
  const net = network && !/^unlocked$/i.test(network) ? network : '';
  return {
    model,
    storage,
    ram,
    cpu: '',
    os: '',
    grade,
    variant: [colour, net].filter(Boolean).join(' · '),
    sub: [storage, ram && `${ram} RAM`, net].filter(Boolean).join(' · '),
  };
}

function parseComputer(name: string): Parsed {
  const segs = name.split('/').map((s) => s.trim()).filter(Boolean);
  const model = segs[0] ?? name;
  const rest = segs.slice(1);
  const grade = rest.length && /^[ABC]$/i.test(rest[rest.length - 1]) ? rest.pop()!.toUpperCase() : '';
  const cpu = rest.find((s) => CPU_RE.test(s) && !/\b(ssd|hdd|emmc)\b/i.test(s)) ?? '';
  const storSeg = rest.find((s) => /\d\s*(GB|TB)\s*(SSD|HDD|eMMC|NVMe|SSHD|Flash|UFS)/i.test(s)) ?? '';
  const ramSeg = rest.find((s) => s !== storSeg && s !== cpu && /^\d+\s*GB(\s*(ram|ddr\w*))?$/i.test(s)) ?? '';
  const ram = (ramSeg.match(/\d+\s*GB/i) ?? [''])[0].replace(/\s/g, '').toUpperCase();
  const storage = storSeg.replace(/\s+/g, ' ');
  const screen = (rest.find((s) => /^\d{2}(\.\d)?\s*"/.test(s)) ?? '').match(/^\d{2}(\.\d)?/)?.[0] ?? '';
  const os = rest.find((s) => /^(w\s?\d{1,2}|win\w*\s*\d{1,2}|chrome\s?os|osx|linux|no os)\b/i.test(s)) ?? '';
  const gpu = (name.match(/\b(rtx|gtx|rx|arc)\s?\w?\d{3,4}\s?(ti|super|xt)?/i) ?? [''])[0];
  return {
    model,
    storage,
    ram,
    cpu,
    os,
    grade,
    variant: '',
    sub: [cpu, ram, storage, gpu.toUpperCase(), screen && `${screen}″`, os.toUpperCase()].filter(Boolean).join(' · '),
  };
}

export function toItem(h: Hit, idx: number, ctx: SupportCtx): Item {
  const name = String(h.boxName ?? '');
  const category = String(h.categoryFriendlyName ?? '');
  const kind = kindOf(category, name);
  const isPc = kind === 'laptop' || kind === 'desktop';
  const p = isPc ? parseComputer(name) : kind === 'other' ? null : parseMobile(name);

  let brand = first(h.Manufacturer).trim();
  if (!brand || brand.length < 2 || /^[^a-z]*$/i.test(brand)) brand = (name.match(BRAND_RE) ?? [])[1] ?? '';
  if (!brand && /^(macbook|imac|mac )/i.test(name)) brand = 'Apple';
  if (!brand && kind !== 'other') brand = name.split(/[\s/]/)[0];
  const brandKey = brand.toLowerCase().replace(/\s+/g, '');

  const model = p?.model ?? '';
  const models = [model, first(h['Phone Model']), first(h['Model Name'])];
  const text = [name, first(h.Generation), first(h['CPU Model'])].join(' ');
  const grade = first(h.Grade).trim().toUpperCase() || p?.grade || '';

  const support = supportFor({ kind, brand: brandKey, models, cpu: p?.cpu ?? '', os: p?.os ?? '', category, name, text }, ctx);
  const specs = kind === 'phone' || kind === 'tablet' ? specsFor(brandKey, models) : null;
  const perf = perfFor({ kind, brand: brandKey, models, cpu: p?.cpu ?? '', cpuAttr: isPc ? '' : first(h['CPU Model']), chip: specs?.sheet?.chip ?? '', text });

  let title = name;
  // The category is part of the key: the PS4 and PS5 editions of a game share a name but are different products.
  let gkey = 'x|' + category + '|' + name.replace(/[,/]\s*(?:unlocked\s*)?[ABC]$/i, '');
  if (p && !isPc && model) {
    // Bare model numbers ("12", "Phone (2a)") read better with the brand in front.
    const hasBrand =
      /^(iphone|ipad|galaxy|pixel|moto|xperia|redmi|poco)/i.test(model) ||
      (brand !== '' && model.toLowerCase().startsWith(brand.toLowerCase()));
    title = hasBrand ? model : `${brand} ${model}`.trim();
    // Tablets of one model come in several screen sizes (iPad Pro 11″ and 13″), so show and group by it.
    const size = kind === 'tablet' ? (name.match(/(\d{1,2}(?:\.\d)?)\s*(?:"|''|”)/)?.[1] ?? '') : '';
    if (size) title += ` ${size}″`;
    gkey = [kind, brandKey, model.toLowerCase(), size, p.storage, p.ram, p.variant.split(' · ')[1] ?? ''].join('|');
  } else if (p && isPc) {
    title = model;
  }

  const img = h.imageUrls?.medium ?? h.imageUrls?.small ?? h.imageUrls?.large ?? '';
  return {
    id: String(h.boxId),
    name,
    price: Number(h.sellPrice) || 0,
    cash: Number(h.cashPriceCalculated) || 0,
    voucher: Number(h.exchangePriceCalculated) || 0,
    category,
    superCat: String(h.superCatFriendlyName ?? ''),
    img: img ? encodeURI(img) : '',
    year: Number(first(h.Year)) || 0,
    grade,
    rating: Number(h.rating) || 0,
    priceChanged: Date.parse(String(h.priceLastChanged ?? '').replace(' ', 'T')) || 0,
    kind,
    brand,
    model,
    storage: p?.storage ?? '',
    ram: p?.ram ?? '',
    cpu: p?.cpu ?? '',
    variant: p?.variant ?? '',
    title,
    sub: p?.sub ?? category,
    gkey,
    support,
    perf,
    idx,
    // Consoles keep their size in the name ("Playstation 5 Console, 825GB, White").
    storageGb: toGb(p?.storage ?? '') || (/consoles?$/i.test(category) ? toGb(name) : 0),
    ramGb: toGb(p?.ram ?? ''),
    screen: specs?.screen || Number(name.match(/(\d{1,2}(?:\.\d)?)\s*(?:"|''|”)/)?.[1] ?? 0),
    os: isPc
      ? /^w/i.test(p?.os ?? '') ? 'Windows' : /chrome/i.test((p?.os ?? '') + category) ? 'ChromeOS' : brandKey === 'apple' || /^(macbook|imac|mac )/i.test(name) ? 'macOS' : ''
      : kind === 'other' ? '' : brandKey === 'apple' ? (kind === 'tablet' ? 'iPadOS' : 'iOS') : /windows/i.test(category) || brandKey === 'microsoft' ? 'Windows' : 'Android',
    gpu: /\b(rtx|gtx|rx)\s?\d{3,4}/i.test(name),
    cellular: kind === 'tablet' && !/wi-?fi/i.test(name.slice(name.lastIndexOf(',') + 1)),
    condition: name.match(/,\s*(Boxed|Unboxed|Discounted)\s*$/i)?.[1] ?? '',
    specs,
  };
}
