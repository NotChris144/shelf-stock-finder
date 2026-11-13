# Shelf — store stock finder

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

Every reason shown is a fact about both items (updates, speed, storage, camera, battery,
condition). Camera and battery facts come from the hand-compiled table in `src/specs.ts`; models
missing from it get no camera or battery comparison. The step-up limit (default £60) is set under
Filters and settings. `npm run sellcheck` prints sample recommendations.

Search filters adapt to the category: phones, tablets, laptops, desktops and consoles each get
their own (`FACETS` in `src/main.ts`).

## Film spines

Film & TV cards have a **Spine** button. It opens a scan of the whole printed sleeve (back, spine,
front), centred on the spine, so there is a colour and a title style to look for on the shelf.

CeX only holds front covers, so the scan comes from [dvdcover.com](https://dvdcover.com), a fan
archive, searched by title (`src/covers.ts`). This is for personal use:

- One film is looked up at a time, only when its button is tapped, and the answer is kept on the
  device (120 days for a scan, 14 days for "none found").
- Only the archive's free low-resolution image is used, with a link back to its page.
- Most scans are US editions, so the viewer says which edition is shown. When there is no scan, it
  shows CeX's front cover and the card stops offering the button.

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
