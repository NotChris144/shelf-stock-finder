# Store stock finder

Mobile-first lookup for what is in stock at one CeX branch (Eastbourne by default), with
update-support and speed ratings for phones, tablets, laptops and desktops.

## Run

```bash
npm install
npm run dev      # http://localhost:5199 — also served on your LAN IP for a phone on the same Wi-Fi
npm run build    # static site in dist/, deployable to any static host
```

Add `?demo` to the address to use built-in sample listings instead of live stock.

## Sales flows

The home screen opens two flows for phones and tablets (`src/flows.ts`, logic in `src/sell.ts`):

- **Step up** — pick the item the customer has chosen; it lists what a little more money buys.
- **Match a budget** — choose a budget and needs; it shows a cheaper option, the best match and
  one a little over, with a side-by-side table.

Every reason shown is a fact about both items (updates, speed, storage, camera, battery, screen,
5G, condition and more). Where GSMArena has tested both phones the measured result is quoted
(battery life, speed, screen brightness); otherwise the spec sheet, and with no sheet the short
table in `src/specs.ts`. The step-up limit (default £60) is set under Filters and settings.

How step-up options are chosen (`stepUps` in `src/sell.ts`):

- Each difference from the pick carries a weight, and a loss counts 1.6 times a gain of the same
  size. An option has to come out clearly ahead, with at least one solid reason behind it.
- Never offered: a phone that drops updates or is clearly slower. A phone already out of updates,
  a much bigger or smaller one, or one nothing is known about has to earn its place.
- Other phones are compared in at least the pick's condition where such a copy is in stock; a
  tidier copy of the pick itself is offered too.
- **One ladder in price order.** Every option better on balance sits above the pick, dearest at the
  top. This includes those within the limit and one or two much bigger steps past it, below a line
  that marks the limit. The best value and best step up keep their names wherever they fall. At
  first only the three smallest steps show, so a £10 or £15 step is never hidden behind a bigger
  one. When nothing within the limit is worth it, the nearest real step beyond it is shown.
- **It carries on past either end.** The ladder is the last thing on the page.
  - Scrolled up past the top, it stretches with growing resistance. Let go once it says
    "Release", and the next three dearer phones come in above.
  - Scrolled down past the bottom, the same brings in the next three cheaper phones below the
    pick. These are every phone of its kind for the same money or less, nearest first. Going down
    is about the saving, so each says first what it gives up. The few that are better on balance
    anyway are marked "Better for less".
  - Each end works on its own, and "Fold back" returns it to how it started. A tap on either end
    does the same as a pull.
  - Nothing cheaper shows until asked for, because the customer has picked theirs. The
    side-by-side table waits behind "Compare side by side".
- **"What matters most?"** (battery, camera, speed, storage, updates, condition, bigger screen)
  filters rather than tilts. Every option shown improves that thing: the cheapest that does, the
  one that improves it most, and the best all-round of those. Each chip shows how many phones
  within the limit improve it. When none does, the screen says so and shows the best all-round
  steps that keep it at least as good. (`stepOptions` in `src/sell.ts`.)

`npm run sellcheck` prints sample recommendations. In the dev build, `await shelf.sim()` in the
console runs twelve kinds of simulated customer over every phone and tablet in stock (`src/sim.ts`)
and reports how often each is offered a real improvement and how often an option would make
things worse for them.

Search filters adapt to the category: phones, tablets, laptops, desktops and consoles each get
their own (`FACETS` in `src/main.ts`).

### Add-ons

**Suggest add-ons**, in any card's expanded view, lists what else on the shelf goes with that
item (`src/addons.ts`). It covers:

- consoles, old and new, handheld PCs and games for every console;
- phones, tablets, laptops, desktops and monitors;
- watches, fitness bands, cameras, action cameras and drones;
- headphones, speakers, TVs, streaming boxes, e-readers, iPods and VR headsets.

Each kind of item has slots in the order they are worth offering. For a PS5 that is a second
controller, games, a headset, controller charging, a stand, the Portal, a wheel and VR. Each slot
says in one line why it goes with the item. Tapping a suggestion puts it in the basket (below).
The first one takes the item itself in too, so the basket's total at the foot of the screen is
the price of the whole sale.

- **Fit** comes from the names and the item's spec sheet. Some examples:
  - the Slim stand for a PS5 Slim or Pro;
  - no boxed games for a digital-only console, but the disc drive for a Slim Digital;
  - microSD Express only for a Switch 2;
  - the case that names this exact phone;
  - USB-C or Lightning by model, and MagSafe only from the iPhone 12;
  - the Apple Pencil each iPad takes;
  - Apple Watch strap sizes by group;
  - S Pens by Galaxy Tab series;
  - lenses by mount, but not the kit lens it comes with;
  - batteries by code.

  Anything that might fit but can't be confirmed is marked "Check it fits"; anything that can't is
  left out.
- **Picks:** up to three per slot. They are the most popular on CeX, the cheapest, and the best
  seller among the dearest third. With two or more from the item's own maker (AirPods for an
  iPhone, Galaxy Buds for a Galaxy), all three come from that maker. Games and amiibo are simply
  the best sellers. An add-on is capped at 60% of the item's price unless the slot says otherwise.

The stock is read when the screen opens, in one request.

Nothing here is judged by eye or by an AI. Three checks keep the suggestions right:

- **The guard** (`guard` in `src/addons.ts`) runs on every suggestion, whatever the rules say. It
  stops any accessory that names a different console, iPhone, iPad, Galaxy or Pixel, and anything
  that works only with another maker's devices (AirTag, MagSafe, Apple Watch, S Pen, SmartTag,
  Pixel Stand).
- **`npm run addoncheck`** runs 71 cases built from real names in Eastbourne's stock. It covers
  the fits above and each mistake found so far. It runs before every deploy, and a failure stops
  the deploy.
- **`npm run addonaudit`** runs every product in a branch's live stock through the rules. It
  reports:
  - anything the guard had to stop: a loose rule, or a product CeX filed under the wrong console;
  - the kinds of product with no add-ons yet;
  - the slots the shelf has nothing for;
  - which slots rely most on "Check it fits".

  In the dev build, `await shelf.audit()` does the same in the console.

## Basket

What the customer at the counter is having, and what it comes to (`src/basket.ts`).

- **Putting things in:**
  - An opened card has **Add to basket**.
  - Where a card holds several copies, each copy's row has a round **+** of its own.
  - Add-ons go in from the add-ons screen.
  - Tapping the same button again takes it out.
- **The basket:** the bottom bar's **Basket** button says how many are in it and opens it.
  - Each item is a card like a search result's. Tapping it opens every detail: updates, when it
    came in, the spec sheet, add-ons and CeX's page.
  - A cross under each price takes it out, and **Empty the basket** clears the lot.
  - The total sits under the cards.
  - Suggest add-ons from a card in the basket puts the basket away and opens the add-ons screen.
  - Each line keeps CeX's record of the item, so it opens the same after a reload.
- **Checked on opening:** each line is checked against CeX again, at most once a minute. A price
  that has changed since it went in is updated and says what it was ("Was £120"). Anything no
  longer listed in stock at the branch is dimmed and says so. It stays in the total, as it may be
  in hand.
- **Kept on the phone:** a reload or a spell in a pocket loses nothing. It is emptied by hand.

## Phone and tablet spec sheets

CeX's records name a phone but hold nothing about its camera, battery, screen or chip. Those come
from [GSMArena](https://www.gsmarena.com)'s device pages, read ahead of time by a script and saved
in `src/data/specs.json`; the app only ever reads that file.

It keeps itself up to date: the stock watch (below) runs it every half hour, going by UK time:

- **9am to 6pm**: it asks CeX what the store has in stock, and reads the sheet of any phone or
  tablet model that has just arrived without one.
- **6pm to 9pm**: it works through the models that still have no sheet. Once there are none, it
  re-reads a few of the oldest sheets.

GSMArena refused an address for ten hours after roughly 50 page requests in a short spell, so 50 is
treated as the day's allowance: 60% for the evening, 40% kept for arrivals in the day, at most ten
pages a run, several seconds apart. The count, the queue of new arrivals and the models GSMArena has
no match for are kept in `scripts/spec-state.json`. A run that finds nothing commits nothing; one
that adds a sheet commits it and redeploys the site. Pull before pushing, as the job commits to
`main`.

By hand:

```
npm run specs              # look up models in scripts/spec-models.json that have no sheet yet
npm run specs -- --cex     # first add whatever the store stocks now to that list
npm run specs -- --max=30  # ask for at most 30 pages this run (default 18)
npm run specs -- --retry   # try again the models GSMArena had no match for
```

- A run stops at the first refusal and keeps what it has; pages already read are kept in
  `.cache/specs`.
- A sheet is saved under CeX's own maker and model name, and only when that name matches exactly
  one GSMArena device. Anything else gets no sheet rather than a guess.
- An opened card lists the sheet and names the device it came from. A model with no sheet falls
  back to the short hand-compiled table in `src/specs.ts`, or shows nothing.
- Filters that read the sheet (5G, wireless charging, water resistance and so on) only appear once
  85% of the phones on screen have one.

## Stock activity

The start screen's Activity group opens **Just in** (everything that has come into stock, newest
first, with how long ago) and **Recently sold** (tech only: phones, tablets, computers, consoles and
electronics).

CeX's search says what a branch has now, not when it arrived or left, and not how many of each. So
a GitHub job (`.github/workflows/stock.yml`, `scripts/stock-watch.sh`) keeps watch through the day:
from 8am to 9pm UK time it lists everything Eastbourne has in stock (about 8,000 products, in 13
queries) a minute after each of CeX's own 10-minute updates, and compares it with the last list
(`src/tracker.ts`). The app picks the record up every minute, so a change shows about a minute or two
after it reaches CeX's website.

GitHub's own timer only starts the day's watch, and proved unreliable (on the first morning none of
its runs started), so it is asked several times each morning, and a running watch carries itself on:
shortly before GitHub's six-hour limit it starts its own successor. If the record says it was last
checked yesterday evening, start the watch by hand: the repository's Actions tab, **Stock activity**,
**Run workflow**.

What each look finds:

- A product that was not there before has come in. Another copy of something already on the shelf
  doesn't show, because CeX lists one entry per product.
- A product missing from the list is asked about on its own. If CeX no longer lists it at the
  branch it has left (the last one sold, or now and then moved to another store); if it is still
  there, the list had a hiccup and nothing has changed.
- Something that leaves and comes back within 12 hours was on hold, reserved or returned, not sold
  and bought in, so neither is shown.
- The first look only sets the starting point.
- Times come from CeX itself. Its search is updated in batches every 10 minutes and each product
  carries the time of its last update, so an arrival or sale is timed by that (kept within the gap
  between two looks), however late GitHub runs the job. Only where no such time fits is it shown as
  "before 9:04".
- Just in does not wait for the job for tech. While it is open it asks CeX directly which tech the
  branch has (about 1,400 products by ID, a fraction of a second), every two minutes, and shows
  anything the job's last look had not seen. So a phone appears within CeX's own 10-minute update
  of being taken into stock. The job's record includes that last look's tech list (`seen`) for
  this.

The record is kept on the `stock-data` branch as one commit that is replaced each time, so it builds
up no history, and the app reads `log.json` straight from there, so the site does not need
redeploying. It holds a week of arrivals and a fortnight of sales. Until it records its first change,
both screens show sample data (real items from the shelf with made-up times), clearly marked; the
first real change replaces it.

### When something came in

An opened card says when the item came into stock (**Came in**), and so does a label read by the
scanner, in its tray. Where a card holds several copies of one model, each copy says it in the list.

- The watch keeps, for every product in stock, when it came in, for as long as it stays in stock
  (the activity record above only keeps a week). Each look writes it to `since.json` on the
  `stock-data` branch (`trackSince` in `src/tracker.ts`). The app reads it when a card opens and
  keeps it for two minutes (`src/arrived.ts`).
- The time is CeX's own, from its 10-minute updates, so it reads "about 2:40pm". Where only the
  gap between two looks is known, it gives the gap.
- Anything already on the shelf when the watch began (13 November 2026) shows as "over 4 days ago
  (records begin Fri 13 Nov)". There will be fewer of these as the old stock sells.
- Anything that came in since the latest look is timed by CeX's own update time, as on Just in, or
  failing that, "after" the latest look.
- Gone and back within 12 hours keeps its first time: it was on hold, reserved or returned.
- With more than one copy, it is when the product came into stock and has stayed in stock since.
  CeX lists one entry per product, so a second copy arriving while the first is on the shelf
  doesn't show.

## Film spines

Film & TV cards have a **Spine** button. It opens a scan of the whole printed sleeve (back, spine,
front), centred on the spine, so there is a colour and a title style to look for on the shelf.

CeX only holds front covers, so the scan comes from [dvdcover.com](https://dvdcover.com), a fan
archive, searched by title (`src/covers.ts`). This is for personal use:

- One film is looked up at a time, only when its button is tapped, and the answer is kept on the
  device (120 days for a scan, 14 days for "none found").
- Only the archive's free low-resolution image is used, with a link back to its page.
- Most scans are US editions, so the viewer says which edition is shown. The viewer only opens
  when there is a scan: with none, a short message says so and the card stops offering the button.

## Scanning labels

The barcode button in the search box opens the scanner (`src/scan.ts`), and so does holding Search
in the bottom bar and sliding up to "Scan a barcode". A CeX shelf label's barcode
is the product ID printed beneath it, so a scan returns the item with its current system price.

- **Live** — every barcode in view is outlined; tap the picture to zoom in on one label.
- **Freeze / Photo** — searches a still tile by tile, so one shot can read several labels. Tap any
  label it missed to look closer. This is the mode to use through cabinet glass.

A barcode needs roughly 1.5 camera pixels per bar to decode, so a label should fill at least a
fifth of the picture's width. The camera only works over HTTPS or on localhost.

## Where the data comes from

- **Stock** — the search index behind uk.webuy.com (`src/api.ts`), filtered to one store and in-stock items.
  This is the site's own unofficial endpoint, so it can change without notice.
- **Update support** — endoflife.date (`src/eol.ts`), bundled as a snapshot and refreshed in the
  browser weekly. `npm run update-support` rebuilds the snapshot. Apple end dates are estimates.
- **Speed** — approximate chip benchmarks in `src/perf.ts`; computers are scored from the processor name.

`npm run selftest` prints how the sample listings are parsed, rated and scored.
