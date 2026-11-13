// The home screen and the two sales flows it opens.
//
//   Step up        – the customer has picked a phone; show what a little more money buys.
//   Match a budget – the customer has named a price; show a cheaper option, the best match and
//                    one a little over, as a ladder where each step states what it adds.
//
// The home screen is the staff member's own. Once a flow shows results the phone gets turned
// round, so from there every line is a plain fact addressed to the customer.

import { compareRows, diffProducts, fit, fitKind, products, stepUps, type Aspect, type Diff, type FitNeeds, type FitType, type Product } from './sell.ts';
import type { Group, Item } from './types.ts';

export interface FlowState {
  mode: '' | 'up' | 'fit';
  /** Product ID of the phone the customer picked (step up). */
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
  cardHtml(g: Group, note?: string, opts?: { cls?: string; tag?: string; vt?: string }): string;
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
    <h3>Browse</h3>
    <div class="tiles">${host.categories().map(([id, label]) => `<button type="button" class="tile" data-act="preset" data-v="${id}"><span>${label}</span>${ICON_NEXT}</button>`).join('')}</div>
    ${recent.length ? `<h3>Recent searches</h3><div class="chips wrap browse">${recent.map((r) => host.chip('recent', r, host.esc(r), false)).join('')}</div>` : ''}
    <p class="hint">Or search above for anything in stock at ${host.esc(host.branch())}. Spelling mistakes are fine.</p>
  </section>`;
}

// ------------------------------------------------------------------ shared pieces

/** What a price difference buys. `than` names the item it is measured from when that is not the rung above. */
function stepHtml(host: FlowHost, delta: number, d: Diff, than = ''): string {
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
    ? d.gains.slice(0, 5).map((g) => `<li>${ICON_CHECK}<span>${host.esc(g)}</span></li>`).join('')
    : '<li class="none"><span>No clear advantage in the details we hold.</span></li>';
  const losses = d.losses.slice(0, 3).map((l) => `<li class="lose">${ICON_MINUS}<span><span class="sr">Gives up: </span>${host.esc(l)}</span></li>`).join('');
  return `<li class="step"><p class="step-head">${head}</p><ul class="gains">${gains}${losses}</ul></li>`;
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
  const steps = stepUps(base, all, host.limit(), focus?.[0]);
  const ups = steps.filter((x) => x.kind !== 'swap');
  const side = steps.find((x) => x.kind === 'swap');
  const lead = ups.find((x) => x.kind === 'focus') ?? ups.find((x) => x.kind === 'best') ?? ups[ups.length - 1];
  const tags: Record<string, string> = {
    same: 'Same phone, better spec',
    value: 'Best value step',
    focus: `Best for ${focus?.[2] ?? ''}`,
    best: 'Best step up',
    reach: 'Next real step',
  };
  const baseName = fullName(base.head);
  // Higher prices sit higher, like rungs: the options are listed dearest first with the pick at
  // the foot. Each option is measured from the pick, and says so directly beneath its card.
  let html = `<p class="from-pick">From the ${host.esc(baseName)}${base.head.grade ? `, grade ${host.esc(base.head.grade)}` : ''}, ${host.money(base.price)}</p>`;
  // One tap on what they care about re-picks the options and puts that reason first.
  html += `<div class="frow wrap focus"><span class="flabel">What matters most?</span>${FOCI.map(([id, label]) => host.chip('focus', id, label, s.fo === id)).join('')}</div>`;
  const far = ups.find((x) => x.kind === 'reach');
  if (!ups.length) html += `<p class="hint">Nothing up to ${host.money(host.limit() * 3)} more is clearly better than it.</p>`;
  else if (far) html += `<p class="hint">Nothing up to ${host.money(host.limit())} more is clearly better. The next step that is costs ${host.money(far.product.price - base.price)} more.</p>`;
  // Said plainly when what they asked about is not on offer, so the options are not read as an answer to it.
  else if (focus && !steps.some((x) => x.diff.up.some((p) => p.aspect === focus[0]))) html += `<p class="hint">Nothing in reach is clearly better for ${focus[2]}. These are the best all-round steps.</p>`;
  html += '<ol class="ladder options">';
  for (const st of [...ups].reverse()) {
    html += rungHtml(host, st.product, tags[st.kind], st === lead) + stepHtml(host, st.product.price - base.price, st.diff, baseName);
  }
  html += rungHtml(host, base, 'Your pick') + '</ol>';
  if (side) {
    html += `<h3>For the same money</h3><ol class="ladder options">${rungHtml(host, side.product, 'Worth a look')}${stepHtml(host, side.product.price - base.price, side.diff, baseName)}</ol>`;
  }
  const cols = [base, ...ups.map((x) => x.product)];
  html += tableHtml(host, cols, ['Your pick', ...ups.map((x) => `${host.money(x.product.price - base.price)} more`)], lead ? cols.indexOf(lead.product) : -1);
  html += limitHtml(host, 'Staff setting: suggest options up to this much more');
  swap(body, html);
}

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
