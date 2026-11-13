// Checks the add-on rules against real names from Eastbourne's stock:  npm run addoncheck
//
// Each case picks an item and states what must, and must not, be offered with it. The stock below
// is a sample copied from the branch on 13 November 2026, listed in CeX's popularity order.
import snapshot from '../src/data/eol-snapshot.json' with { type: 'json' };
import sheets from '../src/data/specs.json' with { type: 'json' };
import { arrange, bandFit, ipadAccFit, lensFit, namesModel, pencilFit, seriesFit, slotsFor, strapFit } from '../src/addons.ts';
import type { EolDb } from '../src/eol.ts';
import { toItem } from '../src/parse.ts';
import { useSheets, type SheetFile } from '../src/specs.ts';
import { makeCtx } from '../src/support.ts';
import type { Hit, Item } from '../src/types.ts';

useSheets(sheets as unknown as SheetFile);
const ctx = makeCtx(snapshot as unknown as EolDb);
let n = 0;
const item = (cat: string, name: string, price: number): Item => {
  const h: Hit = { boxId: `t${++n}`, boxName: name, sellPrice: price, categoryFriendlyName: cat, superCatFriendlyName: '' };
  return toItem(h, n, ctx);
};

// [category, name, price], most popular first within the file.
const STOCK: [string, string, number][] = [
  ['Playstation5 Controllers', 'PS5 Official DualSense Controller White, B', 58],
  ['Playstation5 Controllers', 'PS5 Official DualSense Controller White, C', 52],
  ['Playstation5 Controllers', 'PS5 Official DualSense Controller Midnight Black, B', 60],
  ['Playstation5 Controllers', 'PS5 Official DualSense Edge Controller White w/Case & All Parts, B', 150],
  ['Playstation5 Accessories', 'Playstation 5 Official DualSense Charging Station', 15],
  ['Playstation5 Accessories', 'Playstation 5 Ultra HD Blu-ray Disc Drive for Digital Pro/Slim', 85],
  ['Playstation5 Accessories', 'Playstation 5 Pulse 3D Wireless Headset - White w/CFI-ZWD1 Dongle', 75],
  ['Playstation5 Accessories', 'Value PS5 Dual Charging Station', 3],
  ['Playstation5 Accessories', 'Playstation 5 Slim Vertical Stand', 10],
  ['Playstation5 Accessories', 'Value PS5 Vertical Stand (Disc & Digital)', 5],
  ['Playstation5 Accessories', 'Value PS Portal Charging Dock', 4],
  ['Playstation5 Accessories', 'Playstation Portal Remote Player, White, Unboxed', 145],
  ['Playstation5 Accessories', 'Logitech G923 Driving Force Racing Wheel+Pedals+Gear Shifter (PC/PS5/PS4)', 160],
  ['Playstation5 Accessories', 'Turtle Beach Stealth 600(Gen3) Black Wireless Headset w/Dongle(PS5/PS4/PC)', 70],
  ['Playstation4 Accessories', 'Turtle Beach Recon 200 (Gen 2) Blue Headset (PS5/Series/PS4/XB1)', 38],
  ['Playstation4 Accessories', 'Value PS4 Wired Headset', 1],
  ['Playstation4 Accessories', 'Hori Racing Wheel Apex Controller for PS5/PS4 (Wheel+Pedals+Clamp)', 40],
  ['PC Headsets', 'HyperX Cloud III Wired Gaming Headset (Multi-Platform) Black/Red, B', 55],
  ['PC Headsets', 'Jabra Evolve2 30 Headset USB-A (MS Stereo), B', 10],
  ['PC Headsets', 'Generic PC Headset, B', 1],
  ['Playstation5 Games', 'EA Sports FC 26 (PS5)', 30],
  ['Playstation5 Games', 'Grand Theft Auto V (PS5)', 15],
  ['Xbox Series Controllers', 'Official Xbox Series Carbon Black Wireless Controller, B', 48],
  ['Xbox One Controllers', 'Official Xbox One Wireless Controller, B', 45],
  ['PC Gaming Controllers', 'GameSir G7 Pro Wireless For Xbox & PC w/Dock - Wuchang:Fallen Feathers, B', 90],
  ['PC Gaming Controllers', 'Logitech G923 Racing Wheel+Pedals +Driving Force Shifter (Xbox & PC) Black', 185],
  ['PC Gaming Controllers', 'Amazon Luna Wireless Controller, B', 32],
  ['Gaming Batteries', 'Official Xbox Series Rechargeable Battery + USB-C Cable', 18],
  ['Xbox Series Games', 'Forza Horizon 5 (Xbox Series)', 20],
  ['Switch Controllers', 'Nintendo Switch Black Pro Controller, B', 35],
  ['Switch Controllers', 'CRKD Nitro Deck+/Plus - Clear Black, B', 35],
  ['Switch Accessories', 'Official Nintendo Switch Dock Set w/Power Adapter & HDMI', 35],
  ['Switch Accessories', 'Official Nintendo Switch Joy-Con Charging Grip', 18],
  ['Switch Accessories', 'Official Nintendo Switch AC Adapter', 18],
  ['Secure Digital Micro (SD)', 'SanDisk Nintendo Switch 128GB microSDXC Card Mushroom UHS-I', 22],
  ['Secure Digital Micro (SD)', 'SanDisk microSD Express 256GB microSDXC UHS-I EX Mario', 50],
  ['Secure Digital Micro (SD)', 'SanDisk Extreme 64GB microSDXC Card UHS-I U3 V30 A2', 18],
  ['Secure Digital Micro (SD)', 'Integral 32GB V30 microSDHC Card', 8],
  ['Switch Games', 'Mario Kart 8 Deluxe', 35],
  ['Switch 2 Controllers', 'Nintendo Switch 2 Black Pro Controller, B', 60],
  ['CeX basics - Phone Accessories', 'CeX basics - iPhone X/XS case - Black/Clear', 4.99],
  ['CeX basics - Phone Accessories', 'CeX basics - iPhone 7 Plus/8 Plus case - Black/Clear', 4.99],
  ['Apple iPhone Accessories', 'OtterBox Symmetry Case for iPhone 15 Pro - Stardust', 5],
  ['Apple iPhone Accessories', 'Apple MagSafe Charger 1m 15W (MHXH3ZM/A)', 25],
  ['Apple iPhone Accessories', 'Apple A1696 18W USB-C Power Adapter', 14],
  ['Apple iPhone Accessories', 'Apple AirTag - Single (MX532M1), B', 21],
  ['Phone Accessories', 'Official Samsung S25 Ultra Silicone Case - Light Blue', 18],
  ['Phone Accessories', 'OtterBox Clearly Protected Samsung Galaxy S9+ Case - Clear', 0.1],
  ['Phone Accessories', 'Samsung Galaxy SmartTag 2 - Black', 15],
  ['Phone Accessories', 'Google Pixel Stand 2nd Gen 2021 Wireless Charging Dock', 45],
  ['CeX basics - Power', 'CeX basics - USB-C 20W Charging Plug', 12],
  ['CeX basics - Power', 'CeX basics - USB Charging Plug 6W', 7],
  ['CeX basics - Power', 'CeX basics - Dual Port USB-C Charging Plug 65W', 20],
  ['CeX basics - Power', 'CeX basics - Wireless Ultra Fast Qi Charging Pad', 10],
  ['CeX basics - Power', 'CeX basics - Magnetic Charger for Watch (Apple Watch) 1m', 8],
  ['CeX basics - Cables', 'CeX basics - Certified Lightning to USB-C 20W Cable 1m', 10],
  ['CeX basics - Cables', 'CeX basics - USB-C to USB-C 100W Cable 1m', 9],
  ['CeX basics - Cables', 'CeX basics - 4K HDMI Cable 1.2m 4K@60Hz', 5],
  ['In-ear Headphones', 'Samsung Galaxy Buds3 Pro (SM-R630) - Silver, B', 78],
  ['In-ear Headphones', 'Generic Bluetooth Headphones In-Ear, B', 3],
  ['Apple AirPods, EarPods & Headphones', 'Apple AirPods 4th Gen A3050+A3053 In-Ear (USB-C Case A3058), B', 85],
  ['Apple AirPods, EarPods & Headphones', 'Apple AirPods Pro A2083+A2084 In-Ear (Wireless Charging Case), C', 80],
  ['Apple Watch', 'Watch SE 2nd Gen (GPS) NO STRAP, Starlight Aluminium, 40mm, B', 95],
  ['Smartwatches', 'Samsung Galaxy Watch7 40mm BT (SM-L300) NO STRAP - Green, B', 90],
  ['Power Banks', 'Belkin BoostCharge 10K 10,000mAH Portable Power Bank - Black', 12],
  ['Batteries', 'Apple Magsafe Battery Pack A2384 (1460mAh)', 45],
  ['Batteries', 'Apple iPhone Air MagSafe Battery - White', 55],
  ['Batteries', 'Official Canon LP-E6N Rechargeable Battery Pack', 12],
  ['Batteries', 'Official Canon LP-E17 Rechargeable Battery Pack', 12],
  ['Batteries', 'GoPro Dual Battery Charger + Battery (AADBD-001-ES)', 6],
  ['Batteries', 'GoPro Rechargeable Battery for HERO9/HERO10', 4],
  ['Apple iPad Accessories', 'Apple Pencil 2nd Gen (A2051), B', 50],
  ['Apple iPad Accessories', 'Apple Pencil (A1603) With Lightning Adapter, A', 68],
  ['Apple iPad Accessories', 'Apple Magic Keyboard for 11" iPad Pro 1st/2nd/3rd Gen & Air 4th - Black, B', 115],
  ['Apple iPad Accessories', 'Apple Magic Keyboard Folio for iPad (10th generation) - White, B', 130],
  ['Apple iPad Accessories', 'Apple iPad Mini A17 Pro Smart Folio Case - Sage', 20],
  ['Tablet Accessories', 'Samsung Galaxy Tab S10 Lite S Pen (EJ-PP610B) - White', 4],
  ['Tablet Accessories', 'Samsung Galaxy Tab S9/S10 Series S-Pen (EJ-PX710) - Black', 18],
  ['Tablet Accessories', 'Samsung Galaxy Tab S11/S12 Ultra S-Pen (EJ‑PX730) - White', 18],
  ['Apple Watch Accessories', 'Sport Band STRAP ONLY, Black (2024), 46mm (M/L), B', 7],
  ['Apple Watch Accessories', 'Sport Band STRAP ONLY, Starlight (2023), 41mm - S/M, B', 6],
  ['Apple Watch Accessories', 'Sport Band STRAP ONLY, White, 42mm/44mm, B', 15],
  ['Apple Watch Accessories', 'Sport Band STRAP ONLY, Black (2024), 42mm (S/M), A', 12],
  ['Wearables Accessories', 'Samsung Galaxy Watch7 Sport Band (S/M) - Green, B', 7],
  ['Wearables Accessories', 'Samsung Galaxy Watch Ultra Marine Band - Dark Grey, B', 18],
  ['Phone Accessories', 'Rode Wireless Micro Twin Microphone Kit (USB-C) - Black, A', 65],
  ['Switch Controllers', 'Nintendo Switch NES Controller (L), B', 20],
  ['Camera Lenses', 'Canon EF-S 18-55mm f/3.5-5.6 II Black Lens', 35],
  ['Camera Lenses', 'Canon EF 50mm f/1.8 II Black Lens', 60],
  ['Camera Lenses', 'Canon RF 50mm f/1.8 STM Black Lens', 155],
  ['Camera Lenses', 'Sony E PZ 16-50mm F/3.5-5.6 SELP1650 OSS Lens', 85],
  ['Camera Lenses', 'Nikon AF-S DX 18-140mm f/3.5-5.6G ED VR Lens', 150],
  ['Secure Digital (SD)', 'SanDisk Extreme 128GB SDXC UHS-I U3 V30 180MB/s', 30],
  ['Camera Accessories', 'GoPro Head Strap and Quick Clip', 12],
  ['PC Mice', 'Apple Magic Mouse 2 Wireless (A1657) White, C', 28],
  ['PC Mice', 'Logitech G502 HERO Wired Gaming Mouse, B', 35],
  ['CeX basics - Cables', 'CeX basics - USB-C 7-in-1 Multiport Hub', 15],
  ['PC Monitors', 'LG 24GN600-B 23.8" FHD IPS 1ms Gaming Monitor, B', 75],
];
const stock = STOCK.map(([c, nm, p]) => item(c, nm, p));

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, detail = ''): void => {
  if (cond) ok++;
  else {
    bad++;
    console.log(`FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
};

/** Everything offered for an item, by slot id: names of picks and of the rest. */
function offered(it: Item): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const sh of arrange(it, slotsFor(it), stock)) out[sh.slot.id] = [...sh.offers, ...sh.rest].map((o) => `${o.item.name}${o.fit === 'check' ? ' [check]' : ''}`);
  return out;
}
const any = (list: string[] | undefined, re: RegExp): boolean => Boolean(list?.some((s) => re.test(s)));
const show = (label: string, o: Record<string, string[]>): void => {
  if (!process.argv.includes('-v')) return;
  console.log(`\n${label}`);
  for (const [k, v] of Object.entries(o)) console.log(`  ${k.padEnd(9)} ${v.join(' | ')}`);
};

// ---- consoles
{
  const o = offered(item('Playstation5 Consoles', 'Playstation 5 Slim Console, 1TB, White, Unboxed', 540));
  show('PS5 Slim', o);
  check('PS5 Slim: DualSense offered', any(o.pad, /DualSense/));
  check('PS5 Slim: Slim stand, not the original one', any(o.stand, /Slim Vertical/) && !any(o.stand, /Disc & Digital/));
  check('PS5 Slim: no disc drive for a disc console', !o.drive);
  check('PS5 Slim: games offered', any(o.games, /PS5/));
  check('PS5 Slim: PS5 headsets and multi-platform ones, not Jabra or generic', any(o.headset, /Pulse 3D/) && any(o.headset, /HyperX/) && !any(o.headset, /Jabra|Generic/));
  check('PS5 Slim: Portal charging dock is not a controller charger', !any(o.charge, /Portal/));
  check('PS5 Slim: PS5 wheels', any(o.wheel, /G923/) && any(o.wheel, /Hori/));
}
{
  const o = offered(item('Playstation5 Consoles', 'Playstation 5 Slim Digital Edition Console, 825GB, White, Discounted', 475));
  check('PS5 Slim Digital: disc drive offered, no games', any(o.drive, /Disc Drive/) && !o.games);
}
{
  const o = offered(item('Playstation5 Consoles', 'Playstation 5 Digital Edition Console, 825GB, White, Unboxed', 485));
  check('PS5 Digital (original): no drive (it can’t take one), no games, original stand', !o.drive && !o.games && any(o.stand, /Disc & Digital/));
}
{
  const o = offered(item('Xbox Series Consoles', 'Xbox Series S Console, 512GB, White, Unboxed', 320));
  show('Series S', o);
  check('Series S: Xbox One and Series pads, GameSir for Xbox, not Luna', any(o.pad, /Series Carbon/) && any(o.pad, /Xbox One Wireless/) && any(o.pad, /GameSir/) && !any(o.pad, /Luna/));
  check('Series S: no disc games', !o.games);
  check('Series S: rechargeable battery', any(o.battery, /Rechargeable/));
  check('Series S: headset for Series, not PS-only', any(o.headset, /Recon 200/) && !any(o.headset, /Pulse|Stealth 600/));
}
{
  const o = offered(item('Switch Consoles', 'Nintendo Switch Lite Console, 32GB Turquoise, Unboxed', 100));
  check('Switch Lite: no dock, no controllers, memory card offered', !o.dock && !o.pad && any(o.memory, /SanDisk/));
}
{
  const o = offered(item('Switch 2 Consoles', 'Switch 2 Console, 256GB + Black Joy-Con 2, (No DLC) Unboxed', 380));
  check('Switch 2: only microSD Express', any(o.memory, /Express/) && !any(o.memory, /Mushroom|Extreme 64/));
}

// ---- phones
{
  const o = offered(item('iPhone 15', 'Apple iPhone 15 Pro 128GB Natural Titanium, Unlocked B', 520));
  show('iPhone 15 Pro', o);
  check('iPhone 15 Pro: its own case only', any(o.case, /iPhone 15 Pro/) && !any(o.case, /X\/XS|8 Plus/));
  check('iPhone 15 Pro: USB-C cable, not Lightning', any(o.cable, /USB-C to USB-C/) && !any(o.cable, /Lightning/));
  check('iPhone 15 Pro: USB-C plugs, not the 6W cube', any(o.plug, /20W/) && !any(o.plug, /6W/));
  check('iPhone 15 Pro: MagSafe charger and battery, not the Air battery', any(o.wireless, /MagSafe/) && any(o.bank, /A2384/) && !any(o.bank, /iPhone Air/));
  check('iPhone 15 Pro: Apple Watch, AirTag, AirPods first', any(o.watch, /Watch SE/) && any(o.tag, /AirTag/) && /AirPods/.test(o.earbuds?.[0] ?? ''));
}
{
  const o = offered(item('Legacy iPhones', 'Apple iPhone XS 256GB Space Grey, Unlocked B', 150));
  check('iPhone XS: the X/XS case, Lightning cable, no MagSafe', any(o.case, /X\/XS/) && any(o.cable, /Lightning/) && !any(o.wireless, /MagSafe/) && !any(o.bank, /MagSafe/i));
}
{
  const o = offered(item('Legacy iPhones', 'Apple iPhone 8 64GB Space Grey, Unlocked B', 70));
  check('iPhone 8: no case (only 8 Plus in stock)', !o.case);
}
{
  const o = offered(item('Android Phones', 'Samsung Galaxy S9 Plus 64GB Midnight Black, Unlocked B', 80));
  check('Galaxy S9 Plus: the S9+ case', any(o.case, /S9\+/));
  const s9 = offered(item('Android Phones', 'Samsung Galaxy S9 64GB Midnight Black, Unlocked B', 60));
  check('Galaxy S9: not the S9+ case', !any(s9.case, /S9\+/));
}
{
  const o = offered(item('Android Phones', 'Samsung Galaxy S24 Ultra 256GB Titanium Grey, Unlocked B', 600));
  show('S24 Ultra', o);
  check('S24 Ultra: Galaxy Buds first, SmartTag, no AirTag, no Apple Watch, no Pixel Stand', /Galaxy Buds/.test(o.earbuds?.[0] ?? '') && any(o.tag, /SmartTag/) && !any(o.tag, /AirTag/) && !any(o.watch, /Watch SE/) && !any(o.wireless, /Pixel Stand/));
  check('S24 Ultra: no S25 Ultra case', !any(o.case, /S25/));
}
{
  const o = offered(item('Android Phones', 'Samsung Galaxy A14 Dual Sim 64GB Black, Unlocked B', 70));
  check('Galaxy A14: memory card (it has a slot), not the Switch-branded one', any(o.memory, /Extreme|Integral/) && !any(o.memory, /Nintendo|Express/));
}

// ---- tablets
{
  const o = offered(item('Apple iPad', 'Apple iPad 8th Gen (A2270) 10.2" 32GB - Space Grey, WiFi B', 135));
  check('iPad 8th Gen: first Pencil only', any(o.pencil, /A1603/) && !any(o.pencil, /2nd Gen/));
  check('iPad 8th Gen: no keyboard that names other iPads', !o.keyboard);
}
{
  const o = offered(item('Apple iPad', 'Apple iPad Pro 11" 2nd Gen (A2228) 128GB - Space Grey, WiFi B', 330));
  check('iPad Pro 11 2nd Gen: Pencil 2 and the 11" Magic Keyboard', any(o.pencil, /2nd Gen/) && !any(o.pencil, /A1603/) && any(o.keyboard, /Magic Keyboard for 11/));
}
{
  const o = offered(item('Apple iPad', 'Apple iPad A16 (A3354) 11" 128GB Silver, WiFi B', 280));
  check('iPad A16: 10th-gen folio to check, first Pencil to check', any(o.keyboard, /10th generation.*\[check\]/) && any(o.pencil, /A1603.*\[check\]/) && !any(o.pencil, /2nd Gen/));
}
{
  const o = offered(item('Tablets - Android', 'Samsung Galaxy Tab S10 Lite 128GB 11" (No Pen) - Grey, WiFi A', 250));
  check('Tab S10 Lite: its own S Pen, the S9/S10 one to check, not the Ultra one', any(o.pen, /S10 Lite S Pen/) && any(o.pen, /S9\/S10.*\[check\]/) && !any(o.pen, /S11/));
}

// ---- watches, cameras, others
{
  const o = offered(item('Apple Watch', 'Watch Series 9 (GPS) NO STRAP, Midnight Aluminium, 45mm, B', 150));
  check('Watch 45mm: large straps, not 41mm or the new small 42mm', any(o.strap, /46mm/) && any(o.strap, /42mm\/44mm/) && !any(o.strap, /41mm|\(S\/M\), A/));
  check('Watch: magnetic charger', any(o.charger, /Watch/));
}
{
  const o = offered(item('Apple Watch', 'Watch Series 10 (GPS) NO STRAP, Jet Black Aluminium, 42mm, B', 170));
  check('Series 10 42mm: small straps', any(o.strap, /41mm/) && any(o.strap, /\(2024\), 42mm/) && !any(o.strap, /46mm|42mm\/44mm/));
}
{
  const o = offered(item('Smartwatches', 'Samsung Galaxy Watch7 40mm BT (SM-L300) NO STRAP - Green, B', 90));
  check('Galaxy Watch7: Watch7 band, not the Ultra one', any(o.strap, /Watch7/) && !any(o.strap, /Ultra/));
}
{
  const o = offered(item('Digital SLR Cameras', 'Canon EOS 80D Body Only, B', 350));
  show('Canon 80D', o);
  check('Canon 80D: EF lens, not RF, Sony or Nikon', any(o.lens, /EF 50mm/) && !any(o.lens, /RF|Sony|Nikon/));
  check('Canon 80D: LP-E6N battery only', any(o.battery, /LP-E6N/) && !any(o.battery, /LP-E17/));
  const kit = offered(item('Digital SLR Cameras', 'Canon EOS 80D + 18mm-55mm, B', 400));
  check('Canon 80D kit: not offered the 18-55 it comes with', any(kit.lens, /EF 50mm/) && !any(kit.lens, /18-55/));
}
{
  const o = offered(item('Switch Consoles', 'Switch Console, 64GB OLED + White Joy-Con, Discounted', 155));
  check('Switch OLED: Pro Controller, not the NES pad; Nitro Deck fits', any(o.pad, /Pro Controller/) && !any(o.pad, /NES/) && any(o.grip, /Nitro Deck(?!.*\[check\])/));
}
{
  const o = offered(item('iPhone 13', 'Apple iPhone 13 128GB Pink, Unlocked B', 280));
  check('iPhone 13: a wireless microphone is not a wireless charger', !any(o.wireless, /Rode/));
}
{
  const o = offered(item('Cameras - Compact System', 'Canon EOS RP 26MP (Body Only) + Mount Adapter EF-EOS R, B', 600));
  check('Canon RP with adapter: RF and EF lenses, LP-E17', any(o.lens, /RF 50/) && any(o.lens, /EF 50/) && any(o.battery, /LP-E17/));
}
{
  const o = offered(item('Cameras - Compact System', 'Sony Alpha 6400 ILCE-6400 (Body Only), B', 500));
  check('Sony a6400: Sony E lens only', any(o.lens, /Sony E PZ/) && !any(o.lens, /Canon|Nikon/));
}
{
  const o = offered(item('Camcorders', 'GoPro Hero 5 4K Ultra 12M Black, B', 80));
  check('GoPro Hero 5: the dual charger (HERO5-8), not HERO9/10 batteries; head strap', any(o.battery, /AADBD/) && !any(o.battery, /HERO9/) && any(o.mount, /Head Strap/) && !o.mic);
}
{
  const o = offered(item('Laptops - Apple Mac', 'MacBook Air 10,1/M1 (8-CPU 7-GPU)/8GB Ram/256GB SSD/13"/SG/B', 380));
  check('MacBook Air M1: Magic Mouse first, USB-C hub', /Magic Mouse/.test(o.mouse?.[0] ?? '') && any(o.hub, /Hub/));
  const old = offered(item('Laptops - Apple Mac', 'MacBook Air 6,1/i5-4260U/4GB Ram/128GB SSD/11"/OSX/B', 90));
  check('MacBook Air 2014: no USB-C hub', !old.hub);
}
check('Films get no add-ons', slotsFor(item('DVD Movies', 'The Matrix', 2)).length === 0);

// ---- the rules on their own
check('namesModel: 15 is not 15 Pro', !namesModel('OtterBox Symmetry Case for iPhone 15 Pro - Stardust', 'iPhone 15'));
check('namesModel: X/XS case fits the X', namesModel('CeX basics - iPhone X/XS case - Black/Clear', 'iPhone X'));
check('seriesFit: S9/S10 pen fits S10 Ultra', seriesFit('Galaxy Tab S9/S10 Series S-Pen', 'Galaxy Tab S10 Ultra') === 'yes');
check('strapFit: 49mm Ultra takes a 46mm band', strapFit('Watch Ultra 2 (Cel) NO STRAP, Natural Titanium, 49mm, B', 'Sport Band STRAP ONLY, Black (2024), 46mm (M/L), B') === 'yes');
check('bandFit: Pixel 41mm', bandFit('Google Pixel Watch 41mm Polished Silver (Wifi/BT) NO STRAP, B', 'Google Pixel Watch Active Band, 41mm - Obsidian, B') === 'yes');
check('lensFit: Nikon D5600 and an AF-S lens', lensFit('Nikon D5600 24.2MP Body Only, B', 'Nikon AF-S DX 18-140mm f/3.5-5.6G ED VR Lens') === 'yes');
check('pencilFit: iPad 5th Gen takes no Pencil', pencilFit(item('Apple iPad', 'Apple iPad 5th Gen (A1822) 9.7" 32GB - Silver, WiFi B', 80), '1') === 'no');
check('ipadAccFit: mini folio is not for a mini 5', ipadAccFit(item('Apple iPad', 'Apple iPad Mini 5th Gen (A2133) 7.9" 64GB - Space Grey, WiFi B', 150), 'Apple iPad Mini A17 Pro Smart Folio Case - Sage') === 'no');

console.log(`${ok} passed, ${bad} failed`);
if (bad) process.exit(1);
