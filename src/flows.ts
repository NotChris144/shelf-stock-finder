// The home screen and the two sales flows it opens.
//
//   Step up        – the customer has picked a phone; show what a little more money buys.
//   Match a budget – the customer has named a price; show a cheaper option, the best match and
//                    one a little over, as a ladder where each step states what it adds.
//
// The home screen is the staff member's own. Once a flow shows results the phone gets turned
// round, so from there every line is a plain fact addressed to the customer.

import { basket } from './basket.ts';
import { compareRows, diffProducts, fit, fitKind, focusCounts, products, stepOptions, type Aspect, type Diff, type FitNeeds, type FitType, type Product, type Step } from './sell.ts';
import { activityRows, drawActivity, TITLES, type ActivityKind } from './activity.ts';
import { arrange, categoriesFor, slotsFor, type Offer } from './addons.ts';
import type { Group, Hit, Item } from './types.ts';

export interface FlowState {
  mode: '' | 'up' | 'fit' | 'add' | ActivityKind;
  /** Which kind of item the activity screens are narrowed to ('' = all). */
  ac: string;
  /** Product ID of the phone the customer picked (step up), or of the item to suggest add-ons for. */
  pick: string;
  bud: number;
  ft: FitType;
  /** Needs as flags: u = still updated, s = 128GB or more, t = grade A or B. */
  need: string;
  /** What the customer said matters most (an Aspect), or '' for no steer. */
  fo: string;
}

export interface FlowHost {
  esc(s: string): string;
  money(n: number): string;
  chip(act: string, value: string | number, label: string, on: boolean, extra?: string): string;
  cardHtml(g: Group, note?: string, opts?: { cls?: string; tag?: string; vt?: string; when?: string; plain?: boolean }): string;
  /** A search result as the app reads it. */
  toItem(h: Hit): Item;
  /** Real products from the branch, for sample screens. */
  sampleHits(): Promise<Hit[]>;
  /** Lets the shared card handler expand a card drawn here. */
  register(g: Group): void;
  /** Every in-stock phone or tablet at the branch. */
  loadKind(kind: 'phone' | 'tablet'): Promise<Item[]>;
  /** An item identified by scanning that may not be in the branch's online stock. */
  scanned(id: string): Item | undefined;
  branch(): string;
  limit(): number;
  recent(): string[];
  /** Browsable categories as [id, label]. */
  categories(): [string, string][];
  /** An item already on screen somewhere, by product ID. */
  item(id: string): Item | undefined;
  /** An item looked up at CeX by product ID, for a screen opened from a saved link. */
  lookup(id: string): Promise<Item | null>;
  /** The branch's stock in these categories, each list in CeX's popularity order (see addonStock). */
  addonStock(cats: string[], ranked: string[][]): Promise<Item[][]>;
  /** A line of news that needs no answer. */
  toast(text: string): void;
  demo: boolean;
}

const BUDGETS = [75, 100, 150, 200, 250, 300, 400];
const LIMITS = [30, 60, 100, 150];
const TYPES: [FitType, string][] = [
  ['phone', 'Any phone'],
  ['iphone', 'iPhone'],
  ['android', 'Android phone'],
  ['ipad', 'iPad'],
  ['androidtab', 'Android tablet'],
];
const NEEDS: [string, string][] = [
  ['u', 'Still gets updates'],
  ['s', '128GB or more'],
  ['t', 'Grade A or B'],
];
/** What a customer might say matters most, as [aspect, label on the chip, how it reads in a sentence]. */
export const FOCI: [Aspect, string, string][] = [
  ['battery', 'Battery', 'battery life'],
  ['camera', 'Camera', 'the camera'],
  ['speed', 'Speed', 'speed'],
  ['storage', 'Storage', 'storage'],
  ['updates', 'Updates', 'software updates'],
  ['condition', 'Condition', 'condition'],
  ['size', 'Bigger screen', 'a bigger screen'],
];
const ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
const ICON_SCAN =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M8 8.5v7M11 8.5v7M13.5 8.5v7M16 8.5v7"/></svg>';
const ICON_BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_MINUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg>';

let pickQuery = '';
let drawn = '';
const stock = new Map<string, { at: number; list: Product[] }>();

async function productsOf(host: FlowHost, kind: 'phone' | 'tablet'): Promise<Product[]> {
  const key = `${host.branch()}|${kind}`;
  const hit = stock.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  const list = products(await host.loadKind(kind), Date.now());
  stock.set(key, { at: Date.now(), list });
  return list;
}

const groupOf = (p: Product): Group => ({ key: 'flow:' + p.key, items: p.items, head: p.head, min: p.price, max: p.items[p.items.length - 1].price });
const vtName = (p: Product): string => 'r' + p.head.id.replace(/[^a-zA-Z0-9]/g, '');
const fullName = (it: Item): string => `${it.title}${it.storage ? ' ' + it.storage.split(' ')[0] : ''}`;

// ------------------------------------------------------------------ home

export function homeHtml(host: FlowHost): string {
  const recent = host.recent();
  return `<section class="home">
    ${host.demo ? '<p class="note">Demo mode — sample listings, not live stock. Remove <code>?demo</code> from the address for live data.</p>' : ''}
    <div class="door">
      <h2>They’ve picked a phone</h2>
      <p>See what a few pounds more would get them.</p>
      <div class="door-field">
        <button type="button" class="door-go" data-act="door-up"><span>Choose their phone</span>${ICON_NEXT}</button>
        <button type="button" class="icon-btn" data-act="scan" aria-label="Scan its label instead">${ICON_SCAN}</button>
      </div>
    </div>
    <div class="door">
      <h2>They’ve given a budget</h2>
      <p>Options around their price, side by side.</p>
      <div class="chips wrap">${BUDGETS.map((b) => host.chip('bud', b, `£${b}`, false)).join('')}${host.chip('bud', 0, 'Other', false, ' ghost')}</div>
    </div>
    ${activityRows()}
    <h3>Browse</h3>
    <div class="tiles">${host.categories().map(([id, label]) => `<button type="button" class="tile" data-act="preset" data-v="${id}"><span>${label}</span>${ICON_NEXT}</button>`).join('')}</div>
    ${recent.length ? `<h3>Recent searches</h3><div class="chips wrap browse">${recent.map((r) => host.chip('recent', r, host.esc(r), false)).join('')}</div>` : ''}
    <p class="hint">Or search above for anything in stock at ${host.esc(host.branch())}. Spelling mistakes are fine.</p>
  </section>`;
}

// ------------------------------------------------------------------ shared pieces

/** What a price difference buys. `than` names the item it is measured from when that is not the rung above. */
function stepHtml(host: FlowHost, delta: number, d: Diff, than = '', most: [number, number] = [5, 3], lossesFirst = false): string {
  // Measured from a named item the line is already long, so it stops at the name; the ticks below finish the thought.
  const head = than
    ? delta > 0
      ? `<b>${host.money(delta)} more</b> than the ${host.esc(than)}`
      : delta < 0
        ? `<b>${host.money(-delta)} less</b> than the ${host.esc(than)}`
        : `<b>Same price</b> as the ${host.esc(than)}`
    : delta > 0
      ? `<b>${host.money(delta)} more</b> gets you`
      : delta < 0
        ? `<b>${host.money(-delta)} less</b>, and you get`
        : '<b>Same price</b>, and you get';
  // No invented reasons: when the facts on hand show no advantage, say so.
  const gains = d.gains.length
    ? d.gains.slice(0, most[0]).map((g) => `<li>${ICON_CHECK}<span>${host.esc(g)}</span></li>`).join('')
    : '<li class="none"><span>No clear advantage in the details we hold.</span></li>';
  const losses = d.losses.slice(0, most[1]).map((l) => `<li class="lose">${ICON_MINUS}<span><span class="sr">Gives up: </span>${host.esc(l)}</span></li>`).join('');
  return `<li class="step"><p class="step-head">${head}</p><ul class="gains">${lossesFirst ? losses + gains : gains + losses}</ul></li>`;
}

function rungHtml(host: FlowHost, p: Product, tag: string, pick = false): string {
  const g = groupOf(p);
  host.register(g);
  return host.cardHtml(g, '', { cls: pick ? ' rung is-pick' : ' rung', tag, vt: vtName(p) });
}

/** Staff control, kept below everything the customer reads. */
function limitHtml(host: FlowHost, label: string): string {
  return `<div class="frow wrap limit"><span class="flabel">${label}</span>${LIMITS.map((l) => host.chip('limit', l, `£${l}`, host.limit() === l)).join('')}</div>`;
}

function tableHtml(host: FlowHost, list: Product[], headers: string[], pick: number): string {
  if (list.length < 2) return '';
  const rows = compareRows(list, Date.now());
  const col = (i: number): string => (i === pick ? ' class="col-pick"' : '');
  return `<h3>Side by side</h3>
  <div class="sbs-wrap"><table class="sbs">
    <thead><tr><th scope="col"><span class="sr">Feature</span></th>${list.map((p, i) => `<th scope="col"${col(i)}><span>${host.esc(headers[i])}</span>${host.esc(fullName(p.head))}</th>`).join('')}</tr></thead>
    <tbody>${rows
      .map((r) => `<tr><th scope="row">${r.label}</th>${r.cells.map((c, i) => `<td class="${r.best === i ? 'best' : ''}${i === pick ? ' col-pick' : ''}">${host.esc(c)}</td>`).join('')}</tr>`)
      .join('')}</tbody>
  </table></div>
  <p class="fine">Figures described as GSMArena’s test were measured by GSMArena. Other speed ratings are approximate, battery capacity is when new, and update dates for Apple devices are estimates.</p>`;
}

const skeleton = '<ul class="list"><li class="card skeleton"></li><li class="card skeleton"></li><li class="card skeleton"></li></ul>';

/** Swap the body, letting matching cards glide to their new places where the browser can. */
function swap(el: HTMLElement, html: string): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const midSlide = document.body.classList.contains('sliding');
  if (doc.startViewTransition && !calm && !midSlide && el.childElementCount && document.visibilityState === 'visible') doc.startViewTransition(() => (el.innerHTML = html));
  else el.innerHTML = html;
}

// ------------------------------------------------------------------ step up

/** True when two short strings differ by at most one inserted, missing or wrong character. */
function oneOff(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || b.length < 3) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function matches(p: Product, words: string[]): boolean {
  const hay = `${p.head.brand} ${p.head.title} ${p.head.storage}`.toLowerCase();
  const parts = hay.split(/[^a-z0-9]+/).filter(Boolean);
  const squashed = parts.join('');
  // Each typed word must start a word of the name ("a" finds the A-series, not every Galaxy);
  // longer run-together input like "iphone12" is matched against the name with spaces removed.
  return words.every((w) => {
    const t = w.replace(/[^a-z0-9]/g, '');
    if (t === '') return false;
    if (parts.some((part) => part.startsWith(t)) || (t.length >= 4 && squashed.includes(t))) return true;
    // Forgive one slip in a longer word: "pixl" still finds Pixel, "galxy" finds Galaxy.
    return t.length >= 4 && parts.some((part) => oneOff(t, part.slice(0, t.length)) || oneOff(t, part.slice(0, t.length + 1)) || oneOff(t, part.slice(0, t.length - 1)));
  });
}

async function drawUp(host: FlowHost, s: FlowState, body: HTMLElement): Promise<void> {
  const token = (drawn = `up|${s.pick}|${pickQuery}|${host.limit()}|${s.fo}`);
  if (!body.childElementCount) body.innerHTML = skeleton;
  let all: Product[];
  try {
    all = [...(await productsOf(host, 'phone')), ...(await productsOf(host, 'tablet'))];
  } catch {
    body.innerHTML = '<div class="empty"><p>Couldn’t load stock. Check your connection.</p><button type="button" class="chip" data-act="retry" aria-pressed="true">Try again</button></div>';
    return;
  }
  if (token !== drawn) return;

  if (!s.pick) {
    const words = pickQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) {
      body.innerHTML = `<p class="hint">Start typing the model they’re holding, or scan its label. ${all.length} phones and tablets are in stock.</p>`;
      return;
    }
    const found = all.filter((p) => matches(p, words)).sort((a, b) => a.head.title.length - b.head.title.length || a.price - b.price).slice(0, 12);
    body.innerHTML = found.length
      ? `<ul class="list picks">${found
          .map((p) => `<li><button type="button" class="pick-row" data-act="pick" data-v="${host.esc(p.head.id)}"><span class="pick-name">${host.esc(fullName(p.head))}</span><span class="pick-meta">${p.items.length > 1 ? `${p.items.length} in stock` : host.esc(p.head.variant || 'Grade ' + p.head.grade)}</span><span class="pick-price">${p.items.length > 1 ? '<small>from</small>' : ''}${host.money(p.price)}</span></button></li>`)
          .join('')}</ul>`
      : `<div class="empty"><p>No phone or tablet in stock matches “${host.esc(pickQuery)}”.</p></div>`;
    return;
  }

  let base = all.find((p) => p.items.some((i) => i.id === s.pick));
  if (!base) {
    const it = host.scanned(s.pick);
    if (it && (it.kind === 'phone' || it.kind === 'tablet')) base = products([it], Date.now())[0];
  }
  if (!base) {
    body.innerHTML = '<div class="empty"><p>That item isn’t a phone or tablet in stock here.</p><button type="button" class="chip" data-act="pick-clear" aria-pressed="true">Choose another</button></div>';
    return;
  }
  // Compared from the copy they are holding, not the cheapest one of that model.
  const held = base.items.find((i) => i.id === s.pick);
  if (held && held !== base.head) base = { ...base, head: held, price: held.price };
  const focus = FOCI.find(([id]) => id === s.fo);
  const limit = host.limit();
  const { ladder, more, beyond, cheaper, fallback } = stepOptions(base, all, limit, focus?.[0]);
  const asked = focus?.[2] ?? '';
  const tags: Record<string, string> = {
    same: 'Same phone, better spec',
    value: 'Best value step',
    least: `Cheapest step for ${asked}`,
    focus: `Best for ${asked}`,
    best: focus ? 'Best all-round' : 'Best step up',
    reach: 'Next real step',
    swap: 'Better for less',
  };
  const baseName = fullName(base.head);
  const more$ = (p: Product): string => `${host.money(p.price - base.price)} more`;
  const over = (st: Step): boolean => st.product.price - base.price > limit;
  // One ladder in price order: every option above the pick, nearest first, whatever it is called.
  // The headline picks keep their names wherever they fall.
  const seen = new Set<string>();
  const rungs = [...ladder.filter((x) => x.kind !== 'swap'), ...more, ...beyond]
    .filter((st) => !seen.has(st.product.key) && Boolean(seen.add(st.product.key)))
    .sort((x, y) => x.product.price - y.product.price || y.gain - x.gain);
  const lead = rungs.find((x) => x.kind === 'focus') ?? rungs.find((x) => x.kind === 'best') ?? rungs.filter((x) => !over(x)).at(-1);
  // A different pick starts again from the smallest steps, with nothing cheaper showing.
  if (shownFor !== s.pick) {
    shownFor = s.pick;
    shownUp = SHOWN;
    shownDown = 0;
    compareOpen = false;
  }
  const up = rungs.slice(0, shownUp);
  const down = cheaper.slice(0, shownDown);

  let html = `<p class="from-pick">From the ${host.esc(baseName)}${base.head.grade ? `, grade ${host.esc(base.head.grade)}` : ''}, ${host.money(base.price)}</p>`;
  // One tap on what they care about shows only options that improve it. Each chip says how many
  // there are within the limit, so the ones worth asking about are plain before they are tapped.
  const counts = focusCounts(base, all, limit, FOCI.map(([id]) => id));
  html += `<div class="frow wrap focus"><span class="flabel">What matters most?</span>${FOCI.map(([id, label]) => host.chip('focus', id, `${label} <em>${counts[id]}</em>`, s.fo === id, counts[id] ? '' : ' none')).join('')}</div>`;
  html += limitHtml(host, 'How far above their price to look');
  // Said plainly when what they asked about is not on offer, so the options are not read as an answer to it.
  if (fallback) html += `<p class="hint">Nothing up to ${host.money(limit)} more is better for ${asked}. These are the best all-round steps, and none is worse for it.</p>`;
  else if (!rungs.length) html += `<p class="hint">Nothing up to ${host.money(limit * 3)} more is ${focus ? `better for ${asked}` : 'clearly better than it'}.</p>`;
  else if (over(rungs[0])) html += `<p class="hint">Nothing up to ${host.money(limit)} more is ${focus ? `better for ${asked}` : 'clearly better'}. The nearest step that is costs ${more$(rungs[0].product)}.</p>`;
  // The table waits to be asked for, so the ladder is what the eye meets.
  if (up.length) {
    html += `<div class="compare-row"><button type="button" class="chip ghost" data-act="compare" aria-expanded="${compareOpen}">${compareOpen ? 'Hide the comparison' : 'Compare side by side'}</button></div>`;
    if (compareOpen) {
      const cols = [base, ...up.slice(0, SHOWN).map((x) => x.product)];
      html += tableHtml(host, cols, ['Your pick', ...up.slice(0, SHOWN).map((x) => more$(x.product))], lead ? cols.indexOf(lead.product) : -1);
    }
  }

  // Higher prices sit higher, like rungs: dearest at the top, the pick in the middle and anything
  // cheaper beneath it. The ladder is the last thing on the page, so it carries on past either end:
  // keep scrolling up past the top for dearer phones, down past the bottom for cheaper ones.
  html += '<ol class="ladder options" id="ladder">';
  const leftUp = rungs.length - up.length;
  if (leftUp || shownUp > SHOWN) {
    const top = rungs[rungs.length - 1];
    html += endHtml('up', leftUp, shownUp > SHOWN, leftUp ? `${leftUp} more, up to ${top ? more$(top.product) : ''}${lead && !up.includes(lead) ? `, with the ${tags[lead.kind].toLowerCase()}` : ''}` : 'All the dearer options are showing');
  }
  const desc = [...up].reverse();
  desc.forEach((st, i) => {
    const tag = tags[st.kind] ?? (over(st) ? 'Over your limit' : '');
    html += rungHtml(host, st.product, tag, st === lead) + stepHtml(host, st.product.price - base.price, st.diff, baseName, st === lead ? undefined : BRIEF);
    // Where the limit falls: between the last rung past it and the first within it.
    if (over(st) && desc[i + 1] && !over(desc[i + 1])) html += `<li class="rung-note limit-line">Above here: more than ${host.money(limit)} over their pick</li>`;
  });
  html += rungHtml(host, base, 'Your pick');
  // Going down is about the saving, so what each gives up is said first.
  for (const st of down) html += rungHtml(host, st.product, tags[st.kind] ?? '') + stepHtml(host, st.product.price - base.price, st.diff, baseName, [2, 3], true);
  const leftDown = cheaper.length - down.length;
  if (leftDown || shownDown) {
    const bottom = cheaper[cheaper.length - 1];
    html += endHtml('down', leftDown, shownDown > 0, leftDown ? `${leftDown} more, down to ${bottom ? host.money(bottom.product.price) : ''}` : 'All the cheaper options are showing');
  }
  html += '</ol>';
  swap(body, html);
}

// ------------------------------------------------------------------ the ladder carries on
//
// The ladder shows the smallest steps first and carries on past either end, the way a list does:
// scrolled up past the top it stretches, and let go there it brings in the next few dearer phones;
// scrolled down past the bottom, the next few cheaper ones. The stretch has some give: it grows
// with ever more resistance, says "Release" once it has gone far enough, and settles back if let go
// sooner. Each end works on its own, and "Fold back" returns it to how it started. A tap on an end
// (or a click, or the keyboard) brings in the next few too.

/** How many steps above the pick show at first, and how many each pull brings in. */
const SHOWN = 3;
const STEP = 3;
/** Reasons listed under a step that is not the recommended one: three gains and the main loss. */
const BRIEF: [number, number] = [3, 1];

/** For the pick being shown: how many dearer and cheaper options are in, and whether the table is open. */
let shownFor = '';
let shownUp = SHOWN;
let shownDown = 0;
let compareOpen = false;

const redraw = (host: FlowHost, s: FlowState, root: HTMLElement): void => {
  const body = root.querySelector<HTMLElement>('#flowBody');
  if (body) void drawUp(host, s, body);
};

/** Bring in the next few at one end (`up` dearer, `down` cheaper). */
export function extend(host: FlowHost, s: FlowState, root: HTMLElement, end: string): void {
  if (end === 'up') shownUp += STEP;
  else shownDown += STEP;
  redraw(host, s, root);
}

/** Put one end back as it started. */
export function fold(host: FlowHost, s: FlowState, root: HTMLElement, end: string): void {
  if (end === 'up') shownUp = SHOWN;
  else shownDown = 0;
  redraw(host, s, root);
}

export function toggleCompare(host: FlowHost, s: FlowState, root: HTMLElement): void {
  compareOpen = !compareOpen;
  redraw(host, s, root);
}

const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

function endHtml(end: 'up' | 'down', left: number, folds: boolean, sub: string): string {
  const what = end === 'up' ? 'dearer' : 'cheaper';
  const next = Math.min(STEP, left);
  const say = end === 'up' ? 'Keep scrolling up for dearer phones' : 'Keep scrolling down for cheaper phones';
  const more = left
    ? `<button type="button" class="end-more" data-act="extend" data-v="${end}">${end === 'up' ? ICON_UP : ICON_DOWN}<span class="end-touch" data-idle="${say}">${say}</span><span class="end-click">Show ${next} ${what}</span></button>`
    : '';
  const back = folds ? `<button type="button" class="link end-fold" data-act="fold" data-v="${end}">Fold back</button>` : '';
  return `<li class="ladder-end ${end}" data-left="${left}" data-next="${next}"><div class="end-in">${more}<span class="end-sub">${sub}</span>${back}</div></li>`;
}

/** How far an end stretches for a finger travel of `dy`: freely at first, then ever more stiffly. */
const resist = (dy: number): number => 260 * (1 - 1 / ((dy * 0.55) / 260 + 1));
/** How far an end has to stretch before letting go brings more in (about 170px of finger). */
const PULL_OPEN = 68;

let lastTouchY = 0;
let stretching: { el: HTMLElement; end: 'up' | 'down'; y0: number; d: number } | null = null;
const atPageBottom = (): boolean => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;

function stretchTo(el: HTMLElement, d: number): void {
  el.style.setProperty('--stretch', `${d.toFixed(1)}px`);
  const ready = d >= PULL_OPEN;
  el.classList.toggle('ready', ready);
  const label = el.querySelector<HTMLElement>('.end-touch');
  if (label) label.textContent = ready ? `Release for ${el.dataset.next} ${el.classList.contains('up') ? 'dearer' : 'cheaper'}` : (label.dataset.idle ?? '');
}

window.addEventListener(
  'touchstart',
  (e) => {
    stretching = null;
    lastTouchY = e.touches[0]?.clientY ?? 0;
  },
  { passive: true },
);

window.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length !== 1 || document.querySelector('dialog[open]')) return;
    const y = e.touches[0].clientY;
    const moved = y - lastTouchY;
    lastTouchY = y;
    if (!stretching) {
      // Only once the page can go no further: at its top with the finger going down, or at its
      // bottom with the finger going up, and only when that end has more to bring in.
      const top = document.querySelector<HTMLElement>('.ladder-end.up');
      const bottom = document.querySelector<HTMLElement>('.ladder-end.down');
      if (moved > 0 && window.scrollY <= 0 && top && top.dataset.left !== '0') stretching = { el: top, end: 'up', y0: y, d: 0 };
      else if (moved < 0 && atPageBottom() && bottom && bottom.dataset.left !== '0') stretching = { el: bottom, end: 'down', y0: y, d: 0 };
      else return;
      stretching.el.classList.add('stretching');
    }
    const dy = stretching.end === 'up' ? y - stretching.y0 : stretching.y0 - y;
    // Ours while it stretches: the browser's own bounce (or refresh) is held back.
    e.preventDefault();
    stretching.d = dy > 0 ? resist(dy) : 0;
    stretchTo(stretching.el, stretching.d);
    // At the bottom the page grows as it stretches; it stays pinned to its end, so what is above moves up.
    if (stretching.end === 'down') window.scrollTo(0, document.documentElement.scrollHeight);
  },
  { passive: false },
);

function endStretch(): void {
  if (!stretching) return;
  const { el, d } = stretching;
  stretching = null;
  el.classList.remove('stretching');
  // Far enough: the same as a tap on that end, so there is one path to keep right.
  if (d >= PULL_OPEN) el.querySelector<HTMLElement>('.end-more')?.click();
  stretchTo(el, 0);
}
window.addEventListener('touchend', endStretch, { passive: true });
window.addEventListener('touchcancel', endStretch, { passive: true });

// ------------------------------------------------------------------ match a budget

async function drawFit(host: FlowHost, s: FlowState, body: HTMLElement): Promise<void> {
  const token = (drawn = `fit|${s.bud}|${s.ft}|${s.need}|${host.limit()}`);
  if (!s.bud) {
    body.innerHTML = '<p class="hint">Choose their budget above to see the options.</p>';
    return;
  }
  if (!body.childElementCount) body.innerHTML = skeleton;
  let all: Product[];
  try {
    all = await productsOf(host, fitKind(s.ft));
  } catch {
    body.innerHTML = '<div class="empty"><p>Couldn’t load stock. Check your connection.</p><button type="button" class="chip" data-act="retry" aria-pressed="true">Try again</button></div>';
    return;
  }
  if (token !== drawn) return;
  const needs: FitNeeds = { type: s.ft, updates: s.need.includes('u'), storage: s.need.includes('s') ? 128 : 0, tidy: s.need.includes('t') };
  const f = fit(all, s.bud, host.limit(), needs);
  const what = TYPES.find(([t]) => t === s.ft)![1].toLowerCase().replace('iphone', 'iPhone').replace('ipad', 'iPad').replace('android', 'Android');

  if (!f.pick) {
    const html = f.nearest
      ? `<p class="hint">Nothing in stock at ${host.money(s.bud)} or under fits. The closest is ${host.money(f.nearest.price - s.bud)} more.</p><ol class="ladder">${rungHtml(host, f.nearest, `Closest match: ${host.money(f.nearest.price - s.bud)} over`, true)}</ol>`
      : `<div class="empty"><p>No ${host.esc(what)} in stock fits those needs. Try turning one off.</p></div>`;
    swap(body, html);
    return;
  }
  // Higher prices sit higher. A step sits under the dearer of two rungs and names the one below,
  // and a missing rung is explained in the place it would have been.
  const pickName = fullName(f.pick.head);
  let html = '<ol class="ladder">';
  if (f.stretch) {
    html += rungHtml(host, f.stretch, `${host.money(f.stretch.price - s.bud)} over budget`);
    html += stepHtml(host, f.stretch.price - f.pick.price, diffProducts(f.pick, f.stretch), pickName);
  } else html += `<li class="rung-note">Nothing up to ${host.money(host.limit())} over budget beats the ${host.esc(pickName)}.</li>`;
  html += rungHtml(host, f.pick, `Best match for ${host.money(s.bud)}`, true);
  if (f.saver) {
    html += stepHtml(host, f.pick.price - f.saver.price, diffProducts(f.saver, f.pick), fullName(f.saver.head));
    html += rungHtml(host, f.saver, f.saverCompromises ? 'Cheapest option' : 'Cheapest that fits');
  } else html += `<li class="rung-note">Nothing cheaper than the ${host.esc(pickName)} in stock is worth comparing.</li>`;
  html += '</ol>';
  // The table reads left to right from cheapest to dearest.
  const rungs = [f.saver, f.pick, f.stretch].filter((p): p is Product => Boolean(p));
  const heads = [f.saver && 'Cheapest', 'Best match', f.stretch && 'A bit more'].filter((h): h is string => Boolean(h));
  html += tableHtml(host, rungs, heads, rungs.indexOf(f.pick));
  html += limitHtml(host, 'Staff setting: go over budget by up to');
  swap(body, html);
}

// ------------------------------------------------------------------ add-ons
//
// What else on the shelf goes with the item: a slot per kind of add-on (src/addons.ts), each
// with two or three picks. Tapping a pick puts it in the basket (src/basket.ts), and the basket's
// total sits at the foot of the screen, so the price of the whole sale is there to say. The first
// add-on takes the item itself in with it, since add-ons go with its sale.

/** Which item the picks below belong to. */
let addFor = '';
const opened = new Set<string>();
/** The item and the add-ons on screen, to go in the basket when tapped. */
let baseItem: Item | null = null;
const offered = new Map<string, Item>();
const addStock = new Map<string, { at: number; p: Promise<Item[][]> }>();

const plainName = (it: Item): string => (it.kind === 'other' ? it.name.replace(/,?\s*\b[ABC]$/, '').replace(/\s+,/g, ',').trim() : fullName(it));

function addonRow(host: FlowHost, o: Offer): string {
  const a = o.item;
  offered.set(a.id, a);
  const on = basket.has(a.id);
  const meta = [o.tag && host.esc(o.tag), a.grade && `Grade ${host.esc(a.grade)}`, o.fit === 'check' && '<span class="addon-check">Check it fits</span>'].filter(Boolean).join(' · ');
  const img = a.img ? `<img src="${host.esc(a.img)}" alt="" loading="lazy" decoding="async" width="44" height="44" onerror="this.remove()">` : '';
  return `<li><button type="button" class="addon" data-act="addon" data-v="${host.esc(a.id)}" data-price="${a.price}" aria-pressed="${on}">
    <span class="addon-img">${img}</span>
    <span class="addon-name">${host.esc(plainName(a))}</span>
    <span class="addon-meta">${meta}</span>
    <span class="addon-price">${host.money(a.price)}</span>
    <span class="addon-tick" aria-hidden="true">${on ? ICON_CHECK : ICON_PLUS}</span>
  </button></li>`;
}

function bundleText(host: FlowHost): string {
  const n = basket.count();
  return `<span class="bundle-what">${n} ${n === 1 ? 'item' : 'items'} in the basket</span><span class="bundle-total">${host.money(basket.total())}</span><button type="button" class="bundle-clear" data-act="basket">View</button>`;
}

/** The basket has changed (here or anywhere else): the ticks and the total follow it. */
export function basketChanged(host: FlowHost): void {
  for (const b of document.querySelectorAll<HTMLElement>('.addon[data-v]')) {
    const on = basket.has(b.dataset.v ?? '');
    if (b.getAttribute('aria-pressed') === String(on)) continue;
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.addon-tick')!.innerHTML = on ? ICON_CHECK : ICON_PLUS;
  }
  const bar = document.getElementById('bundle');
  if (!bar) return;
  bar.hidden = basket.count() === 0;
  bar.innerHTML = bundleText(host);
}

async function drawAdd(host: FlowHost, s: FlowState, body: HTMLElement): Promise<void> {
  if (addFor !== s.pick) {
    addFor = s.pick;
    opened.clear();
    offered.clear();
  }
  const token = (drawn = `add|${s.pick}|${[...opened].join(',')}`);
  if (!body.childElementCount) body.innerHTML = skeleton;
  const fail = (msg: string, retry = false): void => {
    body.innerHTML = `<div class="empty"><p>${msg}</p>${retry ? '<button type="button" class="chip" data-act="retry" aria-pressed="true">Try again</button>' : ''}</div>`;
  };
  if (host.demo) return fail('Add-ons need live stock. Remove <code>?demo</code> from the address to see them.');
  let it: Item | null = host.item(s.pick) ?? host.scanned(s.pick) ?? null;
  let lists: Item[][];
  try {
    it ??= await host.lookup(s.pick);
    if (token !== drawn) return;
    if (!it) return fail('That item isn’t on CeX’s system any more.');
    const slots = slotsFor(it);
    if (!slots.length) return fail('There are no add-ons set up for this kind of item yet.');
    const { cats, ranked } = categoriesFor(slots);
    const key = `${host.branch()}|${cats.join(',')}|${ranked.map((r) => r.join(',')).join('+')}`;
    let got = addStock.get(key);
    if (!got || Date.now() - got.at > 60_000) {
      got = { at: Date.now(), p: host.addonStock(cats, ranked) };
      addStock.set(key, got);
      got.p.catch(() => addStock.delete(key));
    }
    lists = await got.p;
  } catch {
    if (token === drawn) fail('Couldn’t load stock. Check your connection.', true);
    return;
  }
  if (token !== drawn) return;
  baseItem = it;
  const shelves = arrange(it, slotsFor(it), lists.flat());
  const grade = it.grade ? `, grade ${host.esc(it.grade)}` : '';
  let html = `<p class="from-pick">For the ${host.esc(plainName(it))}${grade}, ${host.money(it.price)}</p>`;
  if (!shelves.length) html += `<div class="empty"><p>Nothing in stock at ${host.esc(host.branch())} goes with it right now.</p></div>`;
  for (const sh of shelves) {
    const open = opened.has(sh.slot.id);
    const list = open ? [...sh.offers, ...sh.rest] : sh.offers;
    const more = sh.rest.length
      ? `<button type="button" class="link addon-more" data-act="addon-more" data-v="${host.esc(sh.slot.id)}" aria-expanded="${open}">${open ? 'Fewer' : `${sh.rest.length} more`}</button>`
      : '';
    html += `<section class="addon-slot" aria-label="${host.esc(sh.slot.title)}">
      <div class="addon-head"><h3>${host.esc(sh.slot.title)}</h3>${more}</div>
      <p class="addon-why">${host.esc(sh.slot.why)}</p>
      <ul class="addons">${list.map((o) => addonRow(host, o)).join('')}</ul>
    </section>`;
  }
  if (shelves.length) html += `<p class="fine">Everything here is in stock at ${host.esc(host.branch())} now. “Check it fits” means its name doesn’t confirm it works with this one. Tap any to add it to the basket.</p>`;
  html += `<div class="bundle" id="bundle" aria-live="polite"${basket.count() ? '' : ' hidden'}>${bundleText(host)}</div>`;
  swap(body, html);
}

/** Put an add-on in the basket, or take it out. The first one takes the item itself in too. */
export function toggleAddon(host: FlowHost, btn: HTMLElement): void {
  const id = btn.dataset.v ?? '';
  if (basket.has(id)) return basket.remove(id);
  const it = offered.get(id);
  if (!it) return;
  const base = baseItem;
  const withBase = base && !basket.has(base.id) && ![...offered.keys()].some((k) => basket.has(k));
  if (withBase) basket.add(base);
  basket.add(it);
  if (withBase) host.toast(`The ${plainName(base).split(',')[0]} went in too`);
}

/** Show every option in a slot, or go back to the picks. */
export function moreAddons(host: FlowHost, s: FlowState, root: HTMLElement, slot: string): void {
  if (opened.has(slot)) opened.delete(slot);
  else opened.add(slot);
  const body = root.querySelector<HTMLElement>('#flowBody');
  if (body) void drawAdd(host, s, body);
}

// ------------------------------------------------------------------ mount

export function renderFlow(host: FlowHost, s: FlowState, root: HTMLElement): void {
  const back = `<button type="button" class="back" data-act="flow-home" aria-label="Back to start">${ICON_BACK}</button>`;
  if (s.mode === 'up') {
    // The field is kept between redraws so typing never loses focus.
    const shell = s.pick ? 'up-picked' : 'up-typing';
    if (root.dataset.shell !== shell) {
      root.dataset.shell = shell;
      root.innerHTML = s.pick
        ? `<div class="flow-head">${back}<h2>A step up from your pick</h2><button type="button" class="link" data-act="pick-clear">Change</button></div><div id="flowBody"></div>`
        : `<div class="flow-head">${back}<h2>Which one have they picked?</h2></div>
           <div class="search flow-field">${ICON_SEARCH}<input id="pickq" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="The phone or tablet they have picked" placeholder="e.g. iPhone 12, Galaxy A16" value="${host.esc(pickQuery)}"><button type="button" class="scan-open" data-act="scan" aria-label="Scan its label">${ICON_SCAN}</button></div>
           <div id="flowBody"></div>`;
    }
    void drawUp(host, s, root.querySelector<HTMLElement>('#flowBody')!);
    return;
  }
  if (s.mode === 'add') {
    if (root.dataset.shell !== 'add') {
      root.dataset.shell = 'add';
      root.innerHTML = `<div class="flow-head"><button type="button" class="back" data-act="flow-back" aria-label="Back">${ICON_BACK}</button><h2>Add-ons</h2></div><div id="flowBody"></div>`;
    }
    void drawAdd(host, s, root.querySelector<HTMLElement>('#flowBody')!);
    return;
  }
  if (s.mode === 'in' || s.mode === 'sold') {
    if (root.dataset.shell !== s.mode) {
      root.dataset.shell = s.mode;
      root.innerHTML = `<div class="flow-head">${back}<h2>${TITLES[s.mode]}</h2></div><div id="flowBody"></div>`;
    }
    void drawActivity(host, s.mode, s.ac, root.querySelector<HTMLElement>('#flowBody')!);
    return;
  }
  root.dataset.shell = 'fit';
  const custom = s.bud && !BUDGETS.includes(s.bud);
  const controls = `<div class="flow-head">${back}<h2>Match a budget</h2></div>
    <div class="fit-form">
      <div class="frow"><span class="flabel">Budget</span>${BUDGETS.map((b) => host.chip('bud', b, `£${b}`, s.bud === b)).join('')}<input class="num" type="number" inputmode="numeric" min="0" step="5" placeholder="Other £" value="${custom ? s.bud : ''}" data-act="budInput" aria-label="Another budget in pounds"></div>
      <div class="frow"><span class="flabel">For</span>${TYPES.map(([t, l]) => host.chip('ftype', t, l, s.ft === t)).join('')}</div>
      <div class="frow"><span class="flabel">Needs</span>${NEEDS.map(([n, l]) => host.chip('need', n, l, s.need.includes(n))).join('')}</div>
    </div>`;
  const form = root.querySelector<HTMLElement>('.fit-shell');
  if (form) form.innerHTML = controls;
  else root.innerHTML = `<div class="fit-shell">${controls}</div><div id="flowBody"></div>`;
  // A budget picked from the home screen may sit off the right edge of its row.
  for (const on of root.querySelectorAll<HTMLElement>('.fit-form .chip[aria-pressed="true"]')) {
    const row = on.parentElement!;
    if (on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth || on.offsetLeft < row.scrollLeft) row.scrollLeft = on.offsetLeft - 80;
  }
  void drawFit(host, s, root.querySelector<HTMLElement>('#flowBody')!);
}

export function setPickQuery(host: FlowHost, s: FlowState, root: HTMLElement, text: string): void {
  pickQuery = text;
  const body = root.querySelector<HTMLElement>('#flowBody');
  if (body) void drawUp(host, s, body);
}

export function resetPickQuery(): void {
  pickQuery = '';
}

/** Forget loaded stock so the next draw asks the server again. */
export function clearStock(): void {
  stock.clear();
}
