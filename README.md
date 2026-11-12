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

## Where the data comes from

- **Stock** — the search index behind uk.webuy.com (`src/api.ts`), filtered to one store and in-stock items.
  This is the site's own unofficial endpoint, so it can change without notice.
- **Update support** — endoflife.date (`src/eol.ts`), bundled as a snapshot and refreshed in the
  browser weekly. `npm run update-support` rebuilds the snapshot. Apple end dates are estimates.
- **Speed** — approximate chip benchmarks in `src/perf.ts`; computers are scored from the processor name.

`npm run selftest` prints how the sample listings are parsed, rated and scored.
