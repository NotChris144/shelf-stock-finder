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
- Up to three rungs: the same phone bigger or tidier, the best value step, and the best step. When
  nothing inside the limit is worth it, the nearest real step beyond it is shown instead.
- "What matters most?" (battery, camera, speed, storage, updates, condition, bigger screen) tilts
  the choice, puts that reason first, and says so when nothing in reach improves it.

`npm run sellcheck` prints sample recommendations. In the dev build, `await shelf.sim()` in the
console runs twelve kinds of simulated customer over every phone and tablet in stock (`src/sim.ts`)
and reports how often each is offered a real improvement and how often an option would make
things worse for them.

Search filters adapt to the category: phones, tablets, laptops, desktops and consoles each get
their own (`FACETS` in `src/main.ts`).

## Phone and tablet spec sheets

CeX's records name a phone but hold nothing about its camera, battery, screen or chip. Those come
from [GSMArena](https://www.gsmarena.com)'s device pages, read ahead of time by a script and saved
in `src/data/specs.json`; the app only ever reads that file.

It keeps itself up to date. A GitHub job (`.github/workflows/specs.yml`) runs every half hour and
goes by UK time:

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
