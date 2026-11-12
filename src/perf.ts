// Approximate performance scoring.
//
// Mobile scores are rounded Geekbench 6 multi-core figures for the chip each model ships with in
// the UK. PC scores are PassMark-style CPU estimates derived from the processor name. Both are
// ballpark numbers for ranking stock against each other, not lab results.

import { norm, stripNet } from './eol.ts';
import type { Kind, Perf } from './types.ts';

const TIER_LABELS = ['', 'Slow', 'Basic', 'Good', 'Fast', 'Top'] as const;
const MOBILE_STEPS = [1100, 2200, 4000, 7000];
const PC_STEPS = [2500, 6000, 12000, 20000];

function make(score: number, chip: string, pc: boolean): Perf {
  const steps = pc ? PC_STEPS : MOBILE_STEPS;
  const tier = (1 + steps.filter((s) => score >= s).length) as Perf['tier'];
  return { score, pct: Math.min(1, score / (pc ? 30000 : 11500)), tier, label: TIER_LABELS[tier], chip };
}

// ---------------------------------------------------------------- mobile chips

const CHIPS: Record<string, number> = {
  'apple a5': 150, 'apple a5x': 200, 'apple a6': 300, 'apple a6x': 350, 'apple a7': 550, 'apple a8': 650,
  'apple a8x': 1000, 'apple a9': 1000, 'apple a9x': 1250, 'apple a10': 1400, 'apple a10x': 2250,
  'apple a11': 2200, 'apple a12': 2800, 'apple a12x': 4600, 'apple a12z': 4650, 'apple a13': 3600,
  'apple a14': 4700, 'apple a15': 5400, 'apple a16': 6500, 'apple a17 pro': 7200, 'apple a18': 8100,
  'apple a18 pro': 8600, 'apple a19': 9200, 'apple a19 pro': 9900, 'apple a20': 10300, 'apple a20 pro': 11000,
  'apple m1': 8400, 'apple m2': 9700, 'apple m3': 11700, 'apple m4': 14700, 'apple m5': 17000,
  'snapdragon 425': 500, 'snapdragon 429': 550, 'snapdragon 435': 600, 'snapdragon 450': 700,
  'snapdragon 625': 850, 'snapdragon 652': 900, 'snapdragon 670': 1300, 'snapdragon 820': 1300,
  'snapdragon 835': 1500, 'snapdragon 845': 2000, 'snapdragon 855': 2600, 'snapdragon 865': 3200,
  'snapdragon 888': 3500, 'snapdragon 8 gen 1': 3800, 'snapdragon 8 gen 2': 5200, 'snapdragon 8 gen 3': 7000,
  'snapdragon 8 elite': 9500, 'exynos 7870': 600, 'exynos 7880': 700, 'exynos 7904': 1000,
  'kirin 659': 800, 'kirin 960': 1300, 'mediatek dimensity 9400+': 8800,
};

function chipScore(name: string): number | undefined {
  const k = name
    .toLowerCase()
    .replace(/\b(bionic|fusion|qualcomm|chip)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return CHIPS[k] ?? CHIPS['apple ' + k];
}

// ---------------------------------------------------------------- phones by model

// "model=score" lists per brand. Scores marked ~ in comments are extrapolated for models
// released after the data was compiled.
const PHONES: Record<string, string> = {
  apple:
    'iphone 4=100;iphone 4s=150;iphone 5=300;iphone 5c=300;iphone 5s=550;iphone 6=650;iphone 6 plus=650;' +
    'iphone 6s=1000;iphone 6s plus=1000;iphone se=1000;iphone 7=1400;iphone 7 plus=1400;iphone 8=2200;' +
    'iphone 8 plus=2200;iphone x=2200;iphone xr=2800;iphone xs=2800;iphone xs max=2800;iphone 11=3600;' +
    'iphone 11 pro=3600;iphone 11 pro max=3600;iphone se 2nd gen=3600;iphone 12=4700;iphone 12 mini=4700;' +
    'iphone 12 pro=4700;iphone 12 pro max=4700;iphone 13=5300;iphone 13 mini=5300;iphone 13 pro=5700;' +
    'iphone 13 pro max=5700;iphone se 3rd gen=5300;iphone 14=5500;iphone 14 plus=5500;iphone 14 pro=6500;' +
    'iphone 14 pro max=6500;iphone 15=6500;iphone 15 plus=6500;iphone 15 pro=7200;iphone 15 pro max=7200;' +
    'iphone 16=8100;iphone 16 plus=8100;iphone 16e=8000;iphone 16 pro=8600;iphone 16 pro max=8600;' +
    'iphone 17=9200;iphone 17e=9100;iphone air=9800;iphone 17 pro=9900;iphone 17 pro max=9900;' +
    'iphone 18 pro=11000;iphone 18 pro max=11000;iphone duo=11000',
  samsung:
    'galaxy s6=1200;galaxy s7=1500;galaxy s7 edge=1500;galaxy s8=1600;galaxy s8 plus=1600;galaxy s9=2000;' +
    'galaxy s9 plus=2000;galaxy s10=2100;galaxy s10e=2100;galaxy s10 plus=2100;galaxy s10 lite=2700;' +
    'galaxy note 8=1600;galaxy note 9=2000;galaxy note 10=2200;galaxy note 10 plus=2200;galaxy note 20=2700;' +
    'galaxy note 20 ultra=2700;galaxy s20=2700;galaxy s20 plus=2700;galaxy s20 ultra=2700;galaxy s20 fe=2900;' +
    'galaxy s20 fe 5g=3200;galaxy s21=3400;galaxy s21 plus=3400;galaxy s21 ultra=3400;galaxy s21 fe=3500;' +
    'galaxy s22=3700;galaxy s22 plus=3700;galaxy s22 ultra=3700;galaxy s23=5200;galaxy s23 plus=5200;' +
    'galaxy s23 ultra=5200;galaxy s23 fe=4000;galaxy s24=6600;galaxy s24 plus=6600;galaxy s24 ultra=7000;' +
    'galaxy s24 fe=6200;galaxy s25=9500;galaxy s25 plus=9500;galaxy s25 ultra=9500;galaxy s25 edge=9500;' +
    'galaxy s25 fe=6900;galaxy s26=10500;galaxy s26 plus=10500;galaxy s26 ultra=11500;galaxy s26 fe=8500;' +
    'galaxy z flip3=3400;galaxy z flip4=4000;galaxy z flip5=5200;galaxy z flip6=6700;galaxy z flip7=7800;' +
    'galaxy z flip7 fe=6500;galaxy z flip8=9500;galaxy z fold3=3400;galaxy z fold4=4000;galaxy z fold5=5200;' +
    'galaxy z fold6=6800;galaxy z fold7=9500;galaxy z fold8=11000;galaxy z fold8 ultra=11500;' +
    'galaxy a02s=500;galaxy a03=1200;galaxy a03 core=600;galaxy a03s=900;galaxy a04e=900;galaxy a04s=1000;' +
    'galaxy a05=1300;galaxy a05s=1500;galaxy a06=1300;galaxy a07=1900;galaxy a10=800;galaxy a10s=800;' +
    'galaxy a12=1000;galaxy a12 nacho=1000;galaxy a13=1050;galaxy a13 5g=1750;galaxy a14=1300;galaxy a14 5g=1900;' +
    'galaxy a15=1950;galaxy a16=1950;galaxy a17=2000;galaxy a18=2100;galaxy a20e=800;galaxy a21s=1000;' +
    'galaxy a22=1300;galaxy a22 5g=1750;galaxy a23=1500;galaxy a23 5g=2000;galaxy a25=2000;galaxy a26=2800;' +
    'galaxy a27=2900;galaxy a32=1300;galaxy a32 5g=1700;galaxy a33=1950;galaxy a34=2500;galaxy a35=2800;' +
    'galaxy a36=2900;galaxy a37=3100;galaxy a40=1000;galaxy a41=1100;galaxy a42=1900;galaxy a50=1300;' +
    'galaxy a51=1350;galaxy a52=1700;galaxy a52 5g=1900;galaxy a52s=2900;galaxy a53=1950;galaxy a54=2800;' +
    'galaxy a55=3400;galaxy a56=3900;galaxy a57=4300;galaxy a70=1500;galaxy a71=1700;galaxy a3=600;' +
    'galaxy a5=700;galaxy a6=600;galaxy a7=1000;galaxy a8=1000;galaxy j3=350;galaxy j4 plus=400;galaxy j5=500;' +
    'galaxy j6=550;galaxy m13=1050;galaxy m31=1300;galaxy xcover 5=1000;galaxy xcover 6 pro=2900;galaxy xcover 7=1950;' +
    'galaxy tab a7=1300;galaxy tab a7 lite=900;galaxy tab a8=1400;galaxy tab a9=1900;galaxy tab a9 plus=2000;' +
    'galaxy tab a11=1900;galaxy tab a11 plus=2900;galaxy tab s5e=1300;galaxy tab s6 lite=1500;galaxy tab s7=3200;' +
    'galaxy tab s7 plus=3200;galaxy tab s7 fe=2000;galaxy tab s8=3800;galaxy tab s8 plus=3800;galaxy tab s8 ultra=3800;' +
    'galaxy tab s9=5200;galaxy tab s9 plus=5200;galaxy tab s9 ultra=5200;galaxy tab s9 fe=2800;galaxy tab s9 fe plus=2800;' +
    'galaxy tab s10 plus=7200;galaxy tab s10 ultra=7200;galaxy tab s10 fe=3900;galaxy tab s10 lite=2900;' +
    'galaxy tab s11=8800;galaxy tab s11 ultra=8800',
  google:
    'pixel 2=1500;pixel 2 xl=1500;pixel 3=2000;pixel 3 xl=2000;pixel 3a=1300;pixel 3a xl=1300;pixel 4=2600;' +
    'pixel 4 xl=2600;pixel 4a=1700;pixel 4a 5g=1900;pixel 5=1900;pixel 5a=1900;pixel 6=2900;pixel 6 pro=2900;' +
    'pixel 6a=2900;pixel 7=3400;pixel 7 pro=3400;pixel 7a=3400;pixel fold=3400;pixel 8=4300;pixel 8 pro=4300;' +
    'pixel 8a=4300;pixel 9=4600;pixel 9 pro=4600;pixel 9 pro xl=4600;pixel 9 pro fold=4600;pixel 9a=4600;' +
    'pixel 10=6200;pixel 10 pro=6200;pixel 10 pro xl=6200;pixel 10 pro fold=6200;pixel 10a=4700;' +
    'pixel 11=7500;pixel 11 pro=7500;pixel 11 pro xl=7500;pixel 11 pro fold=7500',
  motorola:
    'moto e7=900;moto e13=1200;moto e14=1250;moto e15=1300;moto g04=1300;moto g05=1400;moto g06=1400;' +
    'moto g06 power=1400;moto g13=1350;moto g14=1500;moto g15=1400;moto g17=1400;moto g22=1100;moto g24=1350;' +
    'moto g30=1400;moto g31=1350;moto g32=1500;moto g35=2200;moto g37=2000;moto g42=1500;moto g50=1700;' +
    'moto g53=1700;moto g62=1800;moto g8 power lite=900;edge 50 ultra=4800;edge 60 neo=3300;edge 70=4100;' +
    'razr 50 ultra=4700;razr 60 ultra=9500;razr 70=3800;razr 70 ultra=10000',
  nothing:
    'phone (1)=3000;phone (2)=4700;phone (2a)=2600;phone (3a)=3300;phone (3a) pro=3300;phone (3)=6900;' +
    'phone (4a)=3700;phone (4a) pro=4500;cmf phone 1=2900;cmf phone 2 pro=3000',
  oneplus:
    '6=2100;6t=2100;7 pro=2700;8=3200;8 pro=3200;9=3500;9 pro=3500;10 pro=4000;11=5200;12=7000;12r=5200;' +
    '13=9500;13r=7000;15=11000;nord 2=3200',
  xiaomi: '12t pro=4200;13=5200;14=7000;14t pro=7200;15=9500;15t pro=8800;17=11000',
  redmi:
    'note 8=1300;note 10=1500;note 10 pro=1750;note 11 pro=1900;note 12=1500;note 12 pro=2400;' +
    'note 13 pro=2900;note 14=1950;note 14 pro=2900;note 14 pro plus=3200;13c=1400;14c=1400;15c=1400',
  honor:
    'x5c plus=900;x6b=1300;x6c=1300;90=3000;200=3100;200 lite=1900;200 smart=2000;400=3300;400 lite=2200;' +
    '400 pro=6500;400 smart=2000;magic5 lite=2000;magic7 lite=2800;magic8 lite=3000;magic 7 lite=2800;magic 8 lite=3000;magic7 pro=9500;magic8 pro=11000;' +
    'magic v3=7000;magic v5=9500',
  huawei:
    'p20 lite=900;p20 pro=1400;p30 lite=1300;p30 pro=2300;p40 pro=2900;mate 20 lite=1200;mate 20 pro=2300;' +
    'p smart=1200;y6=400',
  sony: 'xperia xa2=1000;xperia 10 iv=2000;xperia 10 vi=2800;xperia 1 iv=4000;xperia 1 v=5200;xperia 5 v=5200',
  oppo: 'find x2 lite=1900;find x5=3500;find x5 lite=2700;find x9 pro=10500;a54=1000',
};

const PHONE_MAP = new Map<string, Map<string, number>>();
for (const [brand, list] of Object.entries(PHONES)) {
  const m = new Map<string, number>();
  for (const pair of list.split(';')) {
    const [name, score] = pair.split('=');
    m.set(norm(name), Number(score));
  }
  PHONE_MAP.set(brand, m);
}

function phoneScore(brand: string, models: string[]): number | undefined {
  const m = PHONE_MAP.get(brand) ?? (brand === 'poco' ? PHONE_MAP.get('xiaomi') : undefined);
  if (!m) return undefined;
  for (const raw of models) {
    if (!raw) continue;
    const k = norm(raw);
    const noYear = k.replace(/20[12]\d$/, '');
    for (const c of [k, stripNet(k), noYear, stripNet(noYear)]) {
      const s = c ? m.get(c) : undefined;
      if (s) return s;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------- iPads

const IPAD_BASE: Record<number, string> = { 5: 'A9', 6: 'A10', 7: 'A10', 8: 'A12', 9: 'A13', 10: 'A14', 11: 'A16' };
const IPAD_MINI: Record<number, string> = { 1: 'A5', 2: 'A7', 3: 'A7', 4: 'A8', 5: 'A12', 6: 'A15', 7: 'A17 Pro' };
const IPAD_AIR: Record<number, string> = { 1: 'A7', 2: 'A8X', 3: 'A12', 4: 'A14', 5: 'M1', 6: 'M2', 7: 'M3', 8: 'M4' };
const IPAD_PRO_129: Record<number, string> = { 1: 'A9X', 2: 'A10X', 3: 'A12X', 4: 'A12Z', 5: 'M1', 6: 'M2' };
const IPAD_PRO_11: Record<number, string> = { 1: 'A12X', 2: 'A12Z', 3: 'M1', 4: 'M2' };

/** Work out which Apple chip an iPad has from whatever CeX put in its name/attributes. */
export function ipadChip(text: string): string {
  const t = text.replace(/\(A\d{4}\)/g, ' ');
  const direct = t.match(/\b(M[1-5]|A1[0-9]X?(?:\s?Pro)?|A[5-9]X?|A12Z)\b/i);
  if (direct && !/\bA\d{4}/.test(direct[0])) return direct[0].toUpperCase().replace('PRO', 'Pro').replace(/(\d)(Pro)/, '$1 $2');
  const fam = /ipad\s*pro/i.test(t) ? 'pro' : /ipad\s*air/i.test(t) ? 'air' : /ipad\s*mini/i.test(t) ? 'mini' : 'base';
  const genM = t.match(/(\d+)(?:st|nd|rd|th)\s*gen/i) ?? t.match(/(?:air|mini|ipad)\s+(\d{1,2})\b(?!["'.\d])/i);
  const gen = genM ? Number(genM[1]) : 0;
  const size = Number((t.match(/(\d{1,2}(?:\.\d)?)\s*(?:"|''|”|-?inch)/i) ?? [])[1] ?? 0);
  if (fam === 'base') return IPAD_BASE[gen] ?? '';
  if (fam === 'mini') return IPAD_MINI[gen] ?? '';
  if (fam === 'air') return IPAD_AIR[gen] ?? (gen === 0 && /air\s*2\b/i.test(t) ? 'A8X' : '');
  if (size === 9.7) return 'A9X';
  if (size === 10.5) return 'A10X';
  if (size >= 12.9) return IPAD_PRO_129[gen] ?? (size >= 13 ? 'M4' : '');
  return IPAD_PRO_11[gen] ?? '';
}

// ---------------------------------------------------------------- PC processors

const U5: Record<number, number> = { 1: 1600, 2: 2300, 3: 2600, 4: 2900, 5: 3000, 6: 3300, 7: 3500, 8: 6000, 9: 6200, 10: 6800, 11: 10000, 12: 13300, 13: 14500, 14: 15000, 15: 15500 };
const H7: Record<number, number> = { 1: 3200, 2: 5200, 3: 6000, 4: 6600, 5: 7000, 6: 6900, 7: 7400, 8: 10000, 9: 11000, 10: 12000, 11: 20500, 12: 26000, 13: 27500, 14: 29000 };
const D5: Record<number, number> = { 1: 2600, 2: 4100, 3: 4600, 4: 5300, 5: 5500, 6: 5700, 7: 6100, 8: 9300, 9: 9500, 10: 13000, 11: 17000, 12: 19500, 13: 27000, 14: 28000 };
const TIER_U: Record<number, number> = { 3: 0.62, 5: 1, 7: 1.12, 9: 1.3 };
const TIER_H: Record<number, number> = { 3: 0.5, 5: 0.77, 7: 1, 9: 1.2 };
const TIER_D: Record<number, number> = { 3: 0.6, 5: 1, 7: 1.35, 9: 1.7 };

const APPLE_M: Record<number, number> = { 1: 14500, 2: 15500, 3: 19000, 4: 25000, 5: 29000 };
const RYZEN_U5: Record<number, number> = { 2: 6500, 3: 7200, 4: 11000, 5: 13500, 6: 15000, 7: 15500, 8: 17500, 9: 19000 };
const RYZEN_H5: Record<number, number> = { 2: 7500, 3: 8000, 4: 14500, 5: 17500, 6: 19000, 7: 20000, 8: 23000, 9: 25000 };
const RYZEN_D5: Record<number, number> = { 1: 11500, 2: 13200, 3: 17800, 4: 16000, 5: 21500, 7: 27500, 8: 25000, 9: 30000 };
const TIER_RU: Record<number, number> = { 3: 0.62, 5: 1, 7: 1.2, 9: 1.4 };
const TIER_RD: Record<number, number> = { 3: 0.55, 5: 1, 7: 1.3, 9: 1.9 };

const last = (t: Record<number, number>, gen: number): number => {
  const keys = Object.keys(t).map(Number);
  const max = Math.max(...keys);
  const min = Math.min(...keys);
  return t[gen] ?? (gen > max ? t[max] : t[min]);
};

/** Which Intel Core generation a model number belongs to ("8250" → 8, "1135" → 11, "10500" → 10). */
export function intelGen(num: string): number {
  if (num.length === 3) return 1;
  if (num.length === 5 || num[0] === '1') return Number(num.slice(0, 2));
  return Number(num[0]);
}

export interface CpuInfo {
  score: number;
  chip: string;
  /** 'intel' | 'amd' | 'apple' | 'arm' | '' */
  vendor: string;
  /** Intel Core generation or Ryzen series, when known. */
  gen: number;
}

export function cpuInfo(raw: string): CpuInfo | null {
  const s = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // Intel Core m3/m5/m7 ("M3-7Y30") must be tested before Apple M-series.
  if ((m = s.match(/\bm([357])-(\d)y\d{2}/))) {
    return { score: 2300 + Number(m[2]) * 80, chip: raw.trim(), vendor: 'intel', gen: Number(m[2]) };
  }
  if ((m = s.match(/\bm([1-5])\b\s*(pro|max|ultra)?/)) && !/\d{4}m\b/.test(s)) {
    const mult = m[2] === 'pro' ? 1.45 : m[2] === 'max' ? 1.75 : m[2] === 'ultra' ? 2.6 : 1;
    const name = `Apple M${m[1]}${m[2] ? ' ' + m[2][0].toUpperCase() + m[2].slice(1) : ''}`;
    return { score: Math.round(APPLE_M[Number(m[1])] * mult), chip: name, vendor: 'apple', gen: Number(m[1]) };
  }
  if ((m = s.match(/ultra\s*([579])[-\s]?(\d{3})([a-z]{0,2})/))) {
    const tier = Number(m[1]);
    const suf = m[3];
    let score: number;
    if (suf === '' || /^[kft]/.test(suf)) {
      score = { 5: 40000, 7: 48000, 9: 60000 }[tier]! * (suf.startsWith('t') ? 0.8 : 1);
    } else {
      const base = { 5: 19000, 7: 23000, 9: 28000 }[tier]!;
      score = base * (suf.startsWith('h') ? (m[2][0] === '2' ? 1.3 : 1.1) : 0.85);
    }
    return { score: Math.round(score), chip: `Core Ultra ${tier} ${m[2]}${suf.toUpperCase()}`, vendor: 'intel', gen: 15 };
  }
  if ((m = s.match(/\bi([3579])[-\s]?(\d{4,5}|\d{3})([a-z]{0,2}\d?)/))) {
    const tier = Number(m[1]);
    const gen = intelGen(m[2]);
    const suf = m[3] ?? '';
    let score: number;
    if (/h|q/.test(suf)) score = last(H7, gen) * TIER_H[tier];
    else if (suf.startsWith('p')) score = last(U5, gen) * 1.25 * TIER_U[tier];
    else if (suf.startsWith('t')) score = last(D5, gen) * 0.8 * TIER_D[tier];
    else if (/u|y|g\d|m/.test(suf)) score = last(U5, gen) * TIER_U[tier] * (suf.includes('y') ? 0.6 : suf === 'm' ? 1.1 : 1);
    else score = last(D5, gen) * TIER_D[tier];
    return { score: Math.round(score), chip: `Core i${tier}-${m[2]}${suf.toUpperCase()}`, vendor: 'intel', gen };
  }
  if ((m = s.match(/ryzen\s*(?:ai\s*)?([3579])\s*(?:pro\s*)?(\d{4})([a-z]{0,3})/))) {
    const tier = Number(m[1]);
    const series = Number(m[2][0]);
    const suf = m[3];
    let score: number;
    if (/^h/.test(suf)) score = last(RYZEN_H5, series) * (tier === 7 ? 1.25 : tier === 9 ? 1.45 : tier === 3 ? 0.62 : 1);
    else if (suf.startsWith('u') || suf.startsWith('c')) {
      // 7x20 parts are older four-core designs.
      score = m[2].slice(2) === '20' ? 9300 * (tier === 3 ? 0.9 : 1) : last(RYZEN_U5, series) * TIER_RU[tier];
    } else score = last(RYZEN_D5, series) * TIER_RD[tier] * (suf.startsWith('ge') ? 0.8 : suf.startsWith('g') ? 0.92 : 1);
    return { score: Math.round(score), chip: `Ryzen ${tier} ${m[2]}${suf.toUpperCase()}`, vendor: 'amd', gen: series };
  }
  if (/\bx1-\d{2}-\d{3}|\bsd x\b/.test(s)) return { score: 15000, chip: 'Snapdragon X', vendor: 'arm', gen: 0 };
  // A bare four-digit model ("7505", "6405U") is an Intel Pentium Gold or Celeron.
  if ((m = s.match(/^(\d{4})[uy]?$/))) {
    return { score: Number(m[1]) >= 7000 ? 5000 : 2400, chip: `Intel ${raw.trim()}`, vendor: 'intel', gen: 0 };
  }
  if (/snapdragon x elite|x1e/.test(s)) return { score: 23000, chip: 'Snapdragon X Elite', vendor: 'arm', gen: 0 };
  if (/snapdragon x|x1p/.test(s)) return { score: 18500, chip: 'Snapdragon X Plus', vendor: 'arm', gen: 0 };
  if (/\bsq[123]\b/.test(s)) return { score: 6500, chip: raw.trim(), vendor: 'arm', gen: 0 };
  if ((m = s.match(/\bn(95|97|100|150|200|250|305|355)\b/))) {
    return { score: Number(m[1]) >= 300 ? 10000 : 5500, chip: `Intel N${m[1]}`, vendor: 'intel', gen: 12 };
  }
  if (/\bcel(eron)?\b|\b[nj][3-6]\d{3}\b/.test(s)) return { score: /[nj]5\d{3}|j4\d{3}/.test(s) ? 3000 : 1700, chip: raw.trim(), vendor: 'intel', gen: 0 };
  if (/\bpent(ium)?\b/.test(s)) return { score: 2400, chip: raw.trim(), vendor: 'intel', gen: 0 };
  if (/\batom\b|\bx[57]-z\d{4}/.test(s)) return { score: 900, chip: raw.trim(), vendor: 'intel', gen: 0 };
  if (/\bathlon\b/.test(s)) return { score: 3200, chip: raw.trim(), vendor: 'amd', gen: 0 };
  if (/\ba(4|6|8|9|10|12)-\d{4}/.test(s)) return { score: 1900, chip: raw.trim(), vendor: 'amd', gen: 0 };
  if (/\be[12]-\d{4}/.test(s)) return { score: 900, chip: raw.trim(), vendor: 'amd', gen: 0 };
  if (/\bxeon\b/.test(s)) return { score: 8000, chip: raw.trim(), vendor: 'intel', gen: 0 };
  return null;
}

// ---------------------------------------------------------------- entry point

export interface PerfInput {
  kind: Kind;
  brand: string;
  /** Candidate model names, most specific first. */
  models: string[];
  cpu: string;
  /** "CPU Model" attribute from CeX, when the index returns it. */
  cpuAttr: string;
  /** Full text to mine for iPad generation hints. */
  text: string;
}

export function perfFor(p: PerfInput): Perf | null {
  if (p.kind === 'laptop' || p.kind === 'desktop') {
    const c = cpuInfo(p.cpu);
    return c ? make(c.score, c.chip, true) : null;
  }
  if (p.kind !== 'phone' && p.kind !== 'tablet') return null;
  if (p.cpuAttr) {
    const s = chipScore(p.cpuAttr);
    if (s) return make(s, p.cpuAttr, false);
  }
  if (p.kind === 'tablet' && p.brand === 'apple') {
    const chip = ipadChip(p.text);
    const s = chip ? chipScore('apple ' + chip) : undefined;
    return s ? make(s, 'Apple ' + chip, false) : null;
  }
  const s = phoneScore(p.brand, p.models);
  return s ? make(s, '', false) : null;
}
