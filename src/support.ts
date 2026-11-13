// "Does this still get updates?" for a parsed stock item.

import { buildIndex, findEntry, type EolDb, type EolEntry, type EolIndex } from './eol.ts';
import { cpuInfo, ipadChip } from './perf.ts';
import type { Kind, Support } from './types.ts';

const MONTH = 30.44 * 864e5;
const YEAR = 365.25 * 864e5;

export interface SupportCtx {
  idx: EolIndex;
  latest: EolDb['latest'];
  now: number;
}

export function makeCtx(db: EolDb, now = Date.now()): SupportCtx {
  const brands = { ...db.brands };
  for (const [b, list] of Object.entries(EXTRA)) brands[b] = [...(brands[b] ?? []), ...list];
  const withExtras: EolDb = { ...db, brands };
  return { idx: buildIndex(withExtras), latest: db.latest, now };
}

export interface SupportInput {
  kind: Kind;
  brand: string;
  models: string[];
  cpu: string;
  /** OS token from a computer's name: "W11", "W10", "Chrome OS"… */
  os: string;
  category: string;
  name: string;
  text: string;
}

// Published update policies for brands endoflife.date doesn't track.
const EXTRA: Record<string, EolEntry[]> = {
  nothing: [
    ['phone1', '2022-07-21', '2026-07-21'],
    ['phone2', '2023-07-17', '2027-07-17'],
    ['phone2a', '2024-03-12', '2028-03-12'],
    ['phone3a', '2025-03-11', '2031-03-11'],
    ['phone3apro', '2025-03-11', '2031-03-11'],
    ['phone3', '2025-07-15', '2032-07-15'],
    ['cmfphone1', '2024-07-12', '2027-07-12'],
    ['cmfphone2pro', '2025-05-06', '2031-05-06'],
  ],
  // Samsung tablets (endoflife.date lists phones only): security-update commitments from launch.
  samsung: [
    ['galaxytaba9', '2023-10-23', '2027-10-23'],
    ['galaxytaba9plus', '2023-10-23', '2027-10-23'],
    ['galaxytabs8', '2022-02-25', '2027-02-25'],
    ['galaxytabs8plus', '2022-02-25', '2027-02-25'],
    ['galaxytabs8ultra', '2022-02-25', '2027-02-25'],
    ['galaxytabs9', '2023-08-11', '2028-08-11'],
    ['galaxytabs9plus', '2023-08-11', '2028-08-11'],
    ['galaxytabs9ultra', '2023-08-11', '2028-08-11'],
    ['galaxytabs9fe', '2023-10-16', '2028-10-16'],
    ['galaxytabs9feplus', '2023-10-16', '2028-10-16'],
    ['galaxytabs10plus', '2024-10-03', '2031-10-03'],
    ['galaxytabs10ultra', '2024-10-03', '2031-10-03'],
    ['galaxytabs10fe', '2025-04-03', '2032-04-03'],
    ['galaxytabs11', '2025-09-04', '2032-09-04'],
    ['galaxytabs11ultra', '2025-09-04', '2032-09-04'],
    ['galaxytabs10lite', '2025-09-05', '2032-09-05'],
    ['galaxytaba11', '2025-09-25', '2032-09-25'],
    ['galaxytaba11plus', '2025-09-25', '2032-09-25'],
    // Older tablets past their support window.
    ['galaxytaba8', '2022-01-17', true],
    ['galaxytaba7', '2020-09-11', true],
    ['galaxytaba7lite', '2021-06-18', true],
    ['galaxytabs7', '2020-08-21', true],
    ['galaxytabs7plus', '2020-08-21', true],
    ['galaxytabs7fe', '2021-06-18', true],
    ['galaxytaba2019', '2019-04-01', true],
    ['galaxytaba', '2018-08-01', true],
  ],
  oneplus: [
    ['8', '2020-04-21', '2023-04-21'],
    ['8pro', '2020-04-21', '2023-04-21'],
    ['9', '2021-03-26', '2025-03-26'],
    ['9pro', '2021-03-26', '2025-03-26'],
    ['10pro', '2022-03-31', '2026-03-31'],
  ],
};

const fmt = (t: number): string => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
const yearOf = (t: number): number => new Date(t).getUTCFullYear();
const maxOs = (range?: string): number => (range ? Number(range.split('-').pop()!.trim()) || 0 : 0);
const UNKNOWN: Support = {
  status: 'unknown',
  label: 'Updates unknown',
  detail: 'No lifecycle data for this model — check the manufacturer before promising updates.',
};
const NA: Support = { status: 'na', label: '', detail: '' };

/** Apple publishes no end dates. It has supported recent devices for about eight years, dropping them each September. */
function appleEstimate(releaseMs: number, now: number): number {
  const d = new Date(now);
  let sept = Date.UTC(d.getUTCFullYear(), 8, 15);
  if (sept <= now) sept = Date.UTC(d.getUTCFullYear() + 1, 8, 15);
  return Math.max(releaseMs + 8 * YEAR, sept);
}

function appleOk(os: string, version: number | string, until: number, now: number): Support {
  if (until - now < 12 * MONTH) {
    return {
      status: 'warn',
      label: `${os} ${version} · ends ~${yearOf(until)}`,
      detail: `Runs the latest ${os} ${version}, but it is among the oldest models Apple still supports — expect updates to stop around ${fmt(until)} (estimate).`,
      until,
      est: true,
    };
  }
  return {
    status: 'ok',
    label: `${os} ${version} · to ~${yearOf(until)}`,
    detail: `Runs the latest ${os} ${version}. Apple doesn't publish end dates; on its track record expect updates until about ${yearOf(until)}.`,
    until,
    est: true,
  };
}

function iphone(e: EolEntry, ctx: SupportCtx): Support {
  const [, rel, eol, os] = e;
  const latest = Number(ctx.latest.ios);
  const max = maxOs(os);
  const endMs = typeof eol === 'string' ? Date.parse(eol) : 0;
  if (eol === true || (endMs && endMs < ctx.now)) {
    return {
      status: 'ended',
      label: 'No updates',
      detail: `Stuck on iOS ${max || '(old)'}${endMs ? ` — Apple stopped updating it in ${fmt(endMs)}` : ''}. Apps will gradually stop supporting it.`,
    };
  }
  if (max && latest && max < latest) {
    return {
      status: 'warn',
      label: `iOS ${max} only`,
      detail: `Won't get iOS ${latest}. Apple is still sending security fixes for iOS ${max}, but not for long.`,
    };
  }
  return appleOk('iOS', latest || max, appleEstimate(Date.parse(rel), ctx.now), ctx.now);
}

function android(e: EolEntry, ctx: SupportCtx): Support {
  const [, , eol, os] = e;
  const max = maxOs(os);
  const latest = Number(ctx.latest.android);
  const osNote = max ? (max >= latest ? ` Runs Android ${max}, the latest.` : ` Tops out at Android ${max}.`) : '';
  if (eol === true) return { status: 'ended', label: 'No updates', detail: 'The manufacturer has stopped security updates for this model.' + osNote };
  if (eol === false) {
    // "No end date on record" is weak evidence for an old model: most Android phones get about four years.
    const rel = Date.parse(e[1]);
    if (rel && ctx.now - rel > 4 * YEAR) {
      return { status: 'warn', stale: true, label: 'Updates may have ended', detail: `No end date published, but it was released in ${fmt(rel)} and most models get about four years of security updates. Check before promising updates.` + osNote };
    }
    return { status: 'ok', label: 'Still updated', detail: 'Still receiving security updates; no end date published.' + osNote };
  }
  const t = Date.parse(eol);
  if (t < ctx.now) return { status: 'ended', label: 'No updates', detail: `Security updates ended ${fmt(t)}.` + osNote };
  if (t - ctx.now < 12 * MONTH) {
    return { status: 'warn', label: `Ends ${fmt(t)}`, detail: `Security updates stop in ${fmt(t)} — under a year left.` + osNote, until: t };
  }
  return { status: 'ok', label: `Updates to ${yearOf(t)}`, detail: `Security updates promised until ${fmt(t)}.` + osNote, until: t };
}

// Newest iPadOS each older chip can run; anything newer than these runs IPAD_KNOWN_LATEST.
const IPAD_MAX: Record<string, number> = { A5: 9, A7: 12, A8: 15, A8X: 15, A9: 16, A9X: 16, A10: 18, A10X: 17, A12: 26, A12X: 26 };
const IPAD_YEAR: Record<string, number> = { A12Z: 2020, A13: 2021, A14: 2020, A15: 2021, A16: 2025, 'A17 Pro': 2024, M1: 2021, M2: 2022, M3: 2025, M4: 2024, M5: 2025 };
const IPAD_KNOWN_LATEST = 27;

function ipad(text: string, ctx: SupportCtx): Support {
  const chip = ipadChip(text);
  if (!chip) return UNKNOWN;
  const latest = Number(ctx.latest.ipados) || IPAD_KNOWN_LATEST;
  const max = IPAD_MAX[chip];
  if (max !== undefined) {
    if (max >= 26 && max < latest) {
      return { status: 'warn', label: `iPadOS ${max} only`, detail: `Won't get iPadOS ${latest} (${chip} chip). Security fixes only for now.` };
    }
    return { status: 'ended', label: 'No updates', detail: `Stuck on iPadOS ${max} (${chip} chip). No longer updated by Apple.` };
  }
  if (latest > IPAD_KNOWN_LATEST) {
    return { status: 'ok', label: `iPadOS ${IPAD_KNOWN_LATEST}+`, detail: `Runs iPadOS ${IPAD_KNOWN_LATEST} (${chip} chip). Check Apple's list for iPadOS ${latest}.` };
  }
  const year = IPAD_YEAR[chip] ?? 2022;
  return appleOk('iPadOS', latest, appleEstimate(Date.UTC(year, 8, 15), ctx.now), ctx.now);
}

function computer(p: SupportInput, ctx: SupportCtx): Support {
  const c = cpuInfo(p.cpu);
  const os = p.os.toLowerCase();
  if (p.brand === 'apple' || /\b(macbook|imac|mac mini|mac studio|mac pro)\b/i.test(p.name)) {
    if (c?.vendor === 'apple') {
      return { status: 'ok', label: `macOS ${ctx.latest.macos}`, detail: `Apple silicon — runs the latest macOS ${ctx.latest.macos}.` };
    }
    if (c?.vendor === 'intel') {
      return c.gen >= 8
        ? { status: 'warn', label: 'Intel Mac · security only', detail: `Intel Macs can't run macOS ${ctx.latest.macos}. Still gets security fixes on an older macOS for now.` }
        : { status: 'ended', label: 'No updates', detail: 'Too old for any macOS version Apple still patches.' };
    }
    return UNKNOWN;
  }
  if (/chrome/.test(os) || /chromebook/i.test(p.category)) {
    return { status: 'unknown', label: 'ChromeOS · check AUE', detail: "Chromebooks have a fixed auto-update expiry date per model — look it up on Google's AUE list." };
  }
  const w = os.match(/w(?:in\w*)?\s*(\d+)/);
  const ver = w ? Number(w[1]) : 0;
  if (ver >= 11) return { status: 'ok', label: 'Windows 11', detail: 'Runs Windows 11, which Microsoft is actively updating.' };
  const canRun11 = !c || c.gen === 0 ? undefined : c.vendor === 'intel' ? c.gen >= 8 : c.vendor === 'amd' ? c.gen >= 2 : true;
  if (ver === 10) {
    if (canRun11) {
      return { status: 'warn', stale: true, label: 'W10 · can run 11', detail: 'Windows 10 support ended Oct 2025, but this processor is on the Windows 11 list — it can be upgraded for free.' };
    }
    if (canRun11 === false) {
      return { status: 'ended', label: 'No updates', detail: 'Windows 10 support ended Oct 2025 and this processor is too old for Windows 11.' };
    }
    return { status: 'warn', stale: true, label: 'Windows 10', detail: 'Windows 10 support ended Oct 2025. Check whether this processor can run Windows 11.' };
  }
  if (ver > 0) return { status: 'ended', label: 'No updates', detail: `Windows ${ver} is no longer supported by Microsoft.` };
  return UNKNOWN;
}

export function supportFor(p: SupportInput, ctx: SupportCtx): Support {
  if (p.kind === 'laptop' || p.kind === 'desktop') return computer(p, ctx);
  if (p.kind === 'other') return NA;
  if (p.brand === 'apple') {
    if (p.kind === 'tablet') return ipad(p.text, ctx);
    const e = findEntry(ctx.idx, 'apple', p.models);
    return e ? iphone(e, ctx) : UNKNOWN;
  }
  if (p.kind === 'tablet' && (p.brand === 'microsoft' || /windows/i.test(p.category))) {
    return { status: 'unknown', label: 'Windows tablet · check', detail: 'Check which Windows it runs (Settings › System › About). Windows 11 is supported; Windows 10 ended Oct 2025.' };
  }
  if (p.brand === 'microsoft' || /lumia|windows phone/i.test(p.name + p.category)) {
    return { status: 'ended', label: 'No updates', detail: 'Windows Phone was discontinued — no updates and very few working apps.' };
  }
  const brand = p.brand === 'hmd' ? 'nokia' : p.brand === 'cmf' ? 'nothing' : p.brand;
  const e = findEntry(ctx.idx, brand, p.models);
  return e ? android(e, ctx) : UNKNOWN;
}
