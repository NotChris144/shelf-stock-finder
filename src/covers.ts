// Finds a scan of a film's whole printed sleeve (back, spine, front), so its spine can be
// recognised on a shelf of spines.
//
// CeX only holds the front cover, so the scan comes from dvdcover.com, a fan archive whose
// search can be read from the browser. It is searched by title, because it holds no barcodes.
// One film is looked up at a time, only when asked for, and the answer is remembered on the
// device, so the archive sees a handful of small requests a day. Only its free, low-resolution
// image is used.

const API = 'https://dvdcover.com/wp-json/wp/v2';
const DAY = 864e5;
/** Width over height of a flat sleeve: about 1.5 for a DVD, 1.8 for a Blu-ray. */
const BLURAY_RATIO = 1.68;
const KEEP_FOUND = 120 * DAY;
const KEEP_MISSING = 14 * DAY;

export interface Cover {
  /** The sleeve laid flat: back on the left, spine in the middle, front on the right. */
  src: string;
  w: number;
  h: number;
  /** The archive's own name for the scan, e.g. "Titanic (1997) WS R1". */
  title: string;
  /** The page the scan came from. */
  link: string;
  region: 'UK' | 'US' | 'Australian' | '';
  bluray: boolean;
}

export interface CoverQuery {
  /** CeX product ID, used to remember the answer. */
  id: string;
  /** CeX product name, e.g. "Green Mile, The (15) 1999 2 Disc". */
  name: string;
  /** Year of the film, 0 when unknown. */
  year: number;
  bluray: boolean;
}

const CERT = /\s*\((?:U|Uc|PG|12A?|15|18|R18|E|Exempt|TBC)\).*$/i;

/** The film's plain title out of a CeX product name. */
export function filmTitle(name: string, year = 0): string {
  let t = name
    // Everything after the certificate is the year and edition notes.
    .replace(CERT, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .trim();
  // A bare year on the end is the film's year, unless it is part of the title ("Blade Runner 2049").
  if (year && t.endsWith(` ${year}`)) t = t.slice(0, -5);
  t = t
    .replace(/\+.*$/, ' ')
    .replace(/,?\s*\b\d+\s*Discs?\b.*$/i, ' ')
    .replace(/\s-\s*(?:\d+\s*Disc|SE|CE|Special|Collector|Extended|Director|Ultimate|Limited|Steelbook|Complete Collection|Box ?set).*$/i, ' ')
    .replace(/\b(?:SE|CE|BR|3D|4K|UHD|Steelbook|Box ?set|Blu-?Ray|DVD)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // "Green Mile, The" and "Hobbit, The: Desolation Of Smaug" put the article first.
  t = t.replace(/^([^,:]+),\s*(The|A|An)(?=$|\s*[:-])/i, '$2 $1');
  return t
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s:-]+$/, '')
    .trim();
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(?:the|a|an|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function decode(html: string): string {
  const el = document.createElement('textarea');
  el.innerHTML = html;
  return el.value;
}

/** Not a retail film sleeve: fan-made art, disc labels, inserts, soundtracks, games. */
const NOT_A_SLEEVE = /custom|label|insert|inlay|sticker|soundtrack|\bcd\b|\b(?:ps[1-5p]|xbox|wii|switch|nintendo|ntsc|3ds|pc)\b/i;
const FOREIGN = /\b(?:german|deutsch|de|french|fr|dutch|nl|italian|spanish|esp|swedish|nordic|scandinavian|danish|norwegian|finnish|polish|czech|turkish|greek|portuguese|russian|hungarian|romanian|japanese)\b/i;
/** Where the film's name stops and the archive's notes (year, region, format) begin. */
const NOTES = /\s*(?:\(\d{4}|\bR[0-9]\b|\bUK\b|\bBlu-?Ray\b|\bDVD\b|\b4K\b|\bUHD\b|\bWS\b|\bFS\b|\bSLIM\b|\bRetail\b|\bCover\b).*$/i;

interface Post {
  title: { rendered: string };
  link: string;
  featured_media: number;
}

interface Candidate {
  title: string;
  link: string;
  media: number;
  score: number;
  region: Cover['region'];
  bluray: boolean;
}

/** The archive's posts that are this film, best edition for a UK shelf first. */
export function rank(posts: Post[], q: CoverQuery): Candidate[] {
  const want = norm(filmTitle(q.name, q.year));
  const wantWords = want.split(' ').filter((w) => w.length > 2);
  const out: Candidate[] = [];
  for (const p of posts) {
    const title = decode(p.title.rendered);
    if (!p.featured_media || NOT_A_SLEEVE.test(title)) continue;
    const got = norm(title.replace(NOTES, ''));
    if (!got) continue;
    const y = Number(title.match(/\((\d{4})/)?.[1]) || 0;
    const exact = got === want;
    if (exact) {
      // A sleeve is often dated a year after the film; anything further out is a remake.
      if (q.year && y && Math.abs(q.year - y) > 1) continue;
    } else {
      // A longer name for the same film ("How the Grinch Stole Christmas" for "The Grinch") has
      // to agree on the year exactly.
      const words = new Set(got.split(' '));
      if (!q.year || y !== q.year || !wantWords.length || !wantWords.every((w) => words.has(w))) continue;
    }
    const notes = title.slice(title.length - (title.match(NOTES)?.[0].length ?? 0));
    const foreign = FOREIGN.test(notes);
    const bluray = /blu-?ray|4k|uhd/i.test(title);
    const region: Cover['region'] = foreign ? '' : /\bR2\b|\bUK\b/i.test(notes) ? 'UK' : /\bR4\b/i.test(notes) ? 'Australian' : /\bR1\b/i.test(notes) ? 'US' : '';
    let score = exact ? 2 : 0;
    if (bluray === q.bluray) score += 4;
    score += foreign ? -2 : region === 'UK' ? 3 : region === 'Australian' ? 2 : region === 'US' ? 1 : 1.5;
    if (q.year && y === q.year) score += 1;
    out.push({ title, link: p.link, media: p.featured_media, score, region, bluray });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Cover search failed (${res.status})`);
  return (await res.json()) as T;
}

const search = (text: string): Promise<Post[]> =>
  get<Post[]>(`/posts?search=${encodeURIComponent(text)}&search_columns=post_title&per_page=50&_fields=title,link,featured_media`);

interface Media {
  media_details?: { sizes?: Record<string, { source_url: string; width: number; height: number }> };
}

/** The archive's free image of a scan, if it is a whole sleeve rather than a front on its own. */
async function sleeve(c: Candidate): Promise<Cover | null> {
  const m = await get<Media>(`/media/${c.media}?_fields=media_details`);
  const sizes = m.media_details?.sizes ?? {};
  const img = sizes['single-free'] ?? sizes['thumbnail-single-image'];
  if (!img || img.width / img.height < 1.4) return null;
  // The shape of the scan says which case it is for more reliably than the archive's title does:
  // a Blu-ray sleeve is much wider for its height than a DVD's.
  const bluray = img.width / img.height >= BLURAY_RATIO;
  return { src: img.source_url, w: img.width, h: img.height, title: c.title, link: c.link, region: c.region, bluray };
}

interface Saved {
  at: number;
  c: Cover | null;
}

const key = (id: string): string => `shelf.cover.${id}`;

/** What an earlier lookup found: a cover, `null` for none, `undefined` when not looked up yet. */
export function remembered(id: string): Cover | null | undefined {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return undefined;
    const s = JSON.parse(raw) as Saved;
    if (Date.now() - s.at > (s.c ? KEEP_FOUND : KEEP_MISSING)) return undefined;
    return s.c;
  } catch {
    return undefined;
  }
}

function remember(id: string, c: Cover | null): void {
  try {
    localStorage.setItem(key(id), JSON.stringify({ at: Date.now(), c } satisfies Saved));
  } catch {
    /* private mode or quota: it is simply looked up again next time */
  }
}

/** Forget a cover whose image would not load, so the next look tries again. */
export function forget(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    /* nothing to forget */
  }
}

/**
 * Look a film's sleeve up. Resolves to `null` when the archive has none; rejects when the
 * archive could not be reached, which is not remembered.
 */
export async function findCover(q: CoverQuery): Promise<Cover | null> {
  const known = remembered(q.id);
  if (known !== undefined) return known;
  const title = filmTitle(q.name, q.year);
  let cover: Cover | null = null;
  if (title.length > 1) {
    let found = rank(await search(title), q);
    // A short, common name ("Creed") drowns in other titles; the year narrows it.
    if (!found.length && q.year) found = rank(await search(`${title} ${q.year}`), q);
    // The first whole sleeve in the right format wins; failing that, the first whole sleeve.
    for (const c of found.slice(0, 3)) {
      const s = await sleeve(c);
      if (!s) continue;
      cover ??= s;
      if (s.bluray === q.bluray) {
        cover = s;
        break;
      }
    }
  }
  remember(q.id, cover);
  return cover;
}

/**
 * Where the spine sits across a flat sleeve, as fractions of its width. The front and back
 * panels have a fixed shape, so whatever width is left over in the middle is the spine: thin
 * for a slim case, wide for a box set.
 */
export function spineOf(c: { w: number; h: number }): { left: number; width: number } {
  const ratio = c.w / c.h;
  // Panel width over height: a DVD sleeve is 129.5 by 183mm a side, a Blu-ray 128 by 148mm.
  const panel = ratio >= BLURAY_RATIO ? 0.865 : 0.7077;
  const width = Math.min(0.2, Math.max(0.02, (ratio - 2 * panel) / ratio));
  return { left: 0.5 - width / 2, width };
}
