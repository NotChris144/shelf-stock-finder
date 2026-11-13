// Camera, battery, screen and feature facts for phones and tablets.
//
// They come from spec sheets read off GSMArena's device pages by `npm run specs` and saved in
// src/data/specs.json, keyed by CeX's own maker and model name. A model with no sheet falls back
// to a short hand-compiled table of the basics, and one in neither simply gets no comparison:
// nothing is estimated. Battery is capacity when new, in mAh (0 = not recorded).

import { norm, stripNet } from './eol.ts';

/** One device's spec sheet as saved, with short names to keep the file small. */
export interface Sheet {
  /** GSMArena's name for the device, and its page id there. */
  n: string;
  id: number;
  /** Year and month it went on sale. */
  y: number;
  m?: number;
  /** Screen: inches, panel, refresh rate, resolution ("1080x2400"). */
  scr: number;
  pan?: 'OLED' | 'LCD';
  hz?: number;
  res?: string;
  /** Battery in mAh, wired charging in watts, wireless charging in watts (0 = has it, speed not given). */
  mah: number;
  w?: number;
  wl?: number;
  /** Main camera megapixels, an ultra-wide lens, optical zoom of the longest lens, selfie megapixels. */
  mp: number;
  uw?: 1;
  tz?: number;
  sf?: number;
  /** Processor as sold in the UK, and the memory sizes it came with, in GB. */
  chip: string;
  ram?: number[];
  g5?: 1;
  /** Water and dust rating, e.g. "IP68". */
  ip?: string;
  /** Memory card slot, headphone socket, contactless, USB-C. */
  sd?: 1;
  jack?: 1;
  nfc?: 1;
  usbc?: 1;
  /** Weight in grams. */
  wt?: number;
  /** System it launched with, and the newest it has been upgraded to. */
  os?: string;
  up?: string;
}

export interface SheetFile {
  /** Date the file was last rebuilt. */
  at: string;
  source: string;
  /** Keyed "maker|model", both as CeX writes them, normalised. */
  sheets: Record<string, Sheet>;
}

let SHEETS: Record<string, Sheet> = {};

/** Hand the saved spec sheets over, once, before any stock is read. */
export function useSheets(file: SheetFile): void {
  SHEETS = file.sheets;
}

export interface Specs {
  /** The full sheet, when there is one; without it only the basics below are known. */
  sheet?: Sheet;
  year: number;
  mah: number;
  /** Main camera megapixels. */
  mp: number;
  ultrawide: boolean;
  /** Optical zoom factor of the telephoto lens, 0 when there is none. */
  zoom: number;
  /** Screen size in inches (0 = not recorded). */
  screen: number;
}

// "model=year,mAh,main MP,lenses,screen inches" where lenses is w (wide) plus u (ultra-wide) and tN (N× telephoto).
const TABLE: Record<string, string> = {
  apple:
    'iphone 6s=2015,1715,12,w,4.7;iphone 6s plus=2015,2750,12,w,5.5;iphone se=2016,1624,12,w,4;iphone 7=2016,1960,12,w,4.7;' +
    'iphone 7 plus=2016,2900,12,wt2,5.5;iphone 8=2017,1821,12,w,4.7;iphone 8 plus=2017,2691,12,wt2,5.5;iphone x=2017,2716,12,wt2,5.8;' +
    'iphone xr=2018,2942,12,w,6.1;iphone xs=2018,2658,12,wt2,5.8;iphone xs max=2018,3174,12,wt2,6.5;iphone 11=2019,3110,12,wu,6.1;' +
    'iphone 11 pro=2019,3046,12,wut2,5.8;iphone 11 pro max=2019,3969,12,wut2,6.5;iphone se 2nd gen=2020,1821,12,w,4.7;' +
    'iphone 12=2020,2815,12,wu,6.1;iphone 12 mini=2020,2227,12,wu,5.4;iphone 12 pro=2020,2815,12,wut2,6.1;' +
    'iphone 12 pro max=2020,3687,12,wut2.5,6.7;iphone 13=2021,3227,12,wu,6.1;iphone 13 mini=2021,2406,12,wu,5.4;' +
    'iphone 13 pro=2021,3095,12,wut3,6.1;iphone 13 pro max=2021,4352,12,wut3,6.7;iphone se 3rd gen=2022,2018,12,w,4.7;' +
    'iphone 14=2022,3279,12,wu,6.1;iphone 14 plus=2022,4325,12,wu,6.7;iphone 14 pro=2022,3200,48,wut3,6.1;' +
    'iphone 14 pro max=2022,4323,48,wut3,6.7;iphone 15=2023,3349,48,wu,6.1;iphone 15 plus=2023,4383,48,wu,6.7;' +
    'iphone 15 pro=2023,3274,48,wut3,6.1;iphone 15 pro max=2023,4422,48,wut5,6.7;iphone 16=2024,3561,48,wu,6.1;' +
    'iphone 16 plus=2024,4674,48,wu,6.7;iphone 16 pro=2024,3582,48,wut5,6.3;iphone 16 pro max=2024,4685,48,wut5,6.9;' +
    'iphone 16e=2025,4005,48,w,6.1;iphone 17=2025,3692,48,wu,6.3;iphone 17 pro=2025,0,48,wut4,6.3;iphone 17 pro max=2025,0,48,wut4,6.9;' +
    'iphone air=2025,3149,48,w,6.5',
  samsung:
    'galaxy s8=2017,3000,12,w,5.8;galaxy s8 plus=2017,3500,12,w,6.2;galaxy s9=2018,3000,12,w,5.8;galaxy s9 plus=2018,3500,12,wt2,6.2;' +
    'galaxy s10=2019,3400,12,wut2,6.1;galaxy s10e=2019,3100,12,wu,5.8;galaxy s10 plus=2019,4100,12,wut2,6.4;' +
    'galaxy note 9=2018,4000,12,wt2,6.4;galaxy note 10=2019,3500,12,wut2,6.3;galaxy note 10 plus=2019,4300,12,wut2,6.8;' +
    'galaxy note 20=2020,4300,12,wut3,6.7;galaxy note 20 ultra=2020,4500,108,wut5,6.9;galaxy s20=2020,4000,12,wut3,6.2;' +
    'galaxy s20 plus=2020,4500,12,wut3,6.7;galaxy s20 ultra=2020,5000,108,wut4,6.9;galaxy s20 fe=2020,4500,12,wut3,6.5;' +
    'galaxy s21=2021,4000,12,wut3,6.2;galaxy s21 plus=2021,4800,12,wut3,6.7;galaxy s21 ultra=2021,5000,108,wut10,6.8;' +
    'galaxy s21 fe=2022,4500,12,wut3,6.4;galaxy s22=2022,3700,50,wut3,6.1;galaxy s22 plus=2022,4500,50,wut3,6.6;' +
    'galaxy s22 ultra=2022,5000,108,wut10,6.8;galaxy s23=2023,3900,50,wut3,6.1;galaxy s23 plus=2023,4700,50,wut3,6.6;' +
    'galaxy s23 ultra=2023,5000,200,wut10,6.8;galaxy s23 fe=2023,4500,50,wut3,6.4;galaxy s24=2024,4000,50,wut3,6.2;' +
    'galaxy s24 plus=2024,4900,50,wut3,6.7;galaxy s24 ultra=2024,5000,200,wut5,6.8;galaxy s24 fe=2024,4700,50,wut3,6.7;' +
    'galaxy s25=2025,4000,50,wut3,6.2;galaxy s25 plus=2025,4900,50,wut3,6.7;galaxy s25 ultra=2025,5000,200,wut5,6.9;' +
    'galaxy s25 fe=2025,4900,50,wut3,6.7;galaxy z flip4=2022,3700,12,wu,6.7;galaxy z flip5=2023,3700,12,wu,6.7;' +
    'galaxy z flip6=2024,4000,50,wu,6.7;galaxy z fold4=2022,4400,50,wut3,7.6;galaxy z fold5=2023,4400,50,wut3,7.6;' +
    'galaxy z fold6=2024,4400,50,wut3,7.6;galaxy a02s=2021,5000,13,w,6.5;galaxy a03=2022,5000,48,w,6.5;galaxy a03 core=2021,5000,8,w,6.5;' +
    'galaxy a03s=2021,5000,13,w,6.5;galaxy a04s=2022,5000,50,w,6.5;galaxy a04e=2022,5000,13,w,6.5;galaxy a05=2023,5000,50,w,6.7;' +
    'galaxy a05s=2023,5000,50,w,6.7;galaxy a06=2024,5000,50,w,6.7;galaxy a10=2019,3400,13,w,6.2;galaxy a12=2020,5000,48,wu,6.5;' +
    'galaxy a13=2022,5000,50,wu,6.6;galaxy a14=2023,5000,50,w,6.6;galaxy a15=2023,5000,50,wu,6.5;galaxy a16=2024,5000,50,wu,6.7;' +
    'galaxy a17=2025,5000,50,wu,6.7;galaxy a20e=2019,3000,13,wu,5.8;galaxy a21s=2020,5000,48,wu,6.5;galaxy a22=2021,5000,48,wu,6.4;' +
    'galaxy a23=2022,5000,50,wu,6.6;galaxy a25=2023,5000,50,wu,6.5;galaxy a26=2025,5000,50,wu,6.7;galaxy a32=2021,5000,64,wu,6.4;' +
    'galaxy a33=2022,5000,48,wu,6.4;galaxy a34=2023,5000,48,wu,6.6;galaxy a35=2024,5000,50,wu,6.6;galaxy a36=2025,5000,50,wu,6.7;' +
    'galaxy a40=2019,3100,16,wu,5.9;galaxy a41=2020,3500,48,wu,6.1;galaxy a42=2020,5000,48,wu,6.6;galaxy a50=2019,4000,25,wu,6.4;' +
    'galaxy a51=2019,4000,48,wu,6.5;galaxy a52=2021,4500,64,wu,6.5;galaxy a52s=2021,4500,64,wu,6.5;galaxy a53=2022,5000,64,wu,6.5;' +
    'galaxy a54=2023,5000,50,wu,6.4;galaxy a55=2024,5000,50,wu,6.6;galaxy a56=2025,5000,50,wu,6.7;galaxy a70=2019,4500,32,wu,6.7;' +
    'galaxy a71=2020,4500,64,wu,6.7;galaxy xcover 5=2021,3000,16,w,5.3',
  google:
    'pixel 3=2018,2915,12,w,5.5;pixel 3a=2019,3000,12,w,5.6;pixel 4=2019,2800,12,wt2,5.7;pixel 4a=2020,3140,12,w,5.8;' +
    'pixel 4a 5g=2020,3885,12,wu,6.2;pixel 5=2020,4080,12,wu,6;pixel 6=2021,4614,50,wu,6.4;pixel 6 pro=2021,5003,50,wut4,6.7;' +
    'pixel 6a=2022,4410,12,wu,6.1;pixel 7=2022,4355,50,wu,6.3;pixel 7 pro=2022,5000,50,wut5,6.7;pixel 7a=2023,4385,64,wu,6.1;' +
    'pixel 8=2023,4575,50,wu,6.2;pixel 8 pro=2023,5050,50,wut5,6.7;pixel 8a=2024,4492,64,wu,6.1;pixel 9=2024,4700,50,wu,6.3;' +
    'pixel 9 pro=2024,4700,50,wut5,6.3;pixel 9 pro xl=2024,5060,50,wut5,6.8;pixel 9a=2025,5100,48,wu,6.3;pixel 10=2025,4970,48,wut5,6.3;' +
    'pixel 10 pro=2025,4870,50,wut5,6.3;pixel 10 pro xl=2025,5200,50,wut5,6.8',
};

const MAP = new Map<string, Map<string, Specs>>();
for (const [brand, list] of Object.entries(TABLE)) {
  const m = new Map<string, Specs>();
  for (const pair of list.split(';')) {
    const [name, raw] = pair.split('=');
    const [year, mah, mp, lenses, screen] = raw.split(',');
    const tele = lenses.match(/t([\d.]+)/);
    m.set(norm(name), { year: Number(year), mah: Number(mah), mp: Number(mp), ultrawide: lenses.includes('u'), zoom: tele ? Number(tele[1]) : 0, screen: Number(screen) || 0 });
  }
  MAP.set(brand, m);
}

export function specsFor(brand: string, models: string[]): Specs | null {
  // A sheet only counts when the name matches exactly: a 5G model must not borrow the 4G one's.
  for (const raw of models) {
    const s = raw ? SHEETS[`${brand}|${norm(raw)}`] : undefined;
    if (s) return { sheet: s, year: s.y, mah: s.mah, mp: s.mp, ultrawide: Boolean(s.uw), zoom: s.tz ?? 0, screen: s.scr };
  }
  const m = MAP.get(brand);
  if (!m) return null;
  for (const raw of models) {
    if (!raw) continue;
    const k = norm(raw);
    const noYear = k.replace(/20[12]\d$/, '');
    for (const c of [k, stripNet(k), noYear, stripNet(noYear)]) {
      const s = c ? m.get(c) : undefined;
      if (s) return s;
    }
  }
  return null;
}

/** Safe under water (IP67, IP68 and the like), as opposed to merely splash-proof (IP54). */
export const waterTight = (s: Sheet | undefined): boolean => /[789]$/.test(s?.ip ?? '');

/** "48MP main, ultra-wide, 5× zoom" */
export function cameraText(s: Specs): string {
  return [`${s.mp}MP main`, s.ultrawide && 'ultra-wide', s.zoom && `${s.zoom}× zoom`].filter(Boolean).join(', ');
}
