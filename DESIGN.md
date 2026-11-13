---
name: Stock finder
description: Store stock finder for one branch, read one-handed on the shop floor and turned towards the customer.
colors:
  bg: "#0c0d10"
  surface: "#16181d"
  surface-2: "#1f2229"
  line: "#2b2f38"
  text: "#f3f4f6"
  muted: "#9aa2af"
  accent: "#ff5a4f"
  accent-ink: "#1a0503"
  ok: "#3ddc97"
  warn: "#ffc247"
  bad: "#ff7a7a"
  unknown: "#8d95a3"
  thumb: "#ffffff"
  bg-light: "#f4f4f1"
  surface-light: "#ffffff"
  surface-2-light: "#ecece8"
  line-light: "#dfdfd9"
  text-light: "#15171c"
  muted-light: "#5d6471"
  accent-light: "#d93025"
  accent-ink-light: "#ffffff"
  ok-light: "#0b8a5c"
  warn-light: "#a86400"
  bad-light: "#c93636"
  unknown-light: "#6a7180"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "23px"
    fontWeight: 760
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 760
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  item-title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  price:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  price-rung:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  price-pick:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "27px"
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: "-0.02em"
  step-price:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "22px"
    fontWeight: 780
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  field:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.35
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.35
  reason:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.35
  control:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14.5px"
    fontWeight: 550
    lineHeight: 1.35
  meta:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  badge:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12.5px"
    fontWeight: 650
    lineHeight: 1.35
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 650
    lineHeight: 1.35
    letterSpacing: "0.04em"
rounded:
  grade: "7px"
  inner: "12px"
  card: "16px"
  sheet: "24px"
  pill: "999px"
spacing:
  tight: "2px"
  badge-gap: "6px"
  gap: "8px"
  inset: "12px"
  gutter: "16px"
components:
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "38px"
  chip-pressed:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
  chip-pressed-flow:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
  chip-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.card}"
    height: "52px"
  button-solid:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.card}"
    padding: "0 14px 0 18px"
    height: "52px"
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    size: "52px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "12px"
  thumb:
    backgroundColor: "{colors.thumb}"
    rounded: "{rounded.inner}"
    size: "64px"
  badge:
    textColor: "{colors.text}"
    typography: "{typography.badge}"
    rounded: "{rounded.pill}"
    padding: "0 9px"
    height: "24px"
  badge-tag:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
  badge-tag-pick:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
  fab:
    backgroundColor: "{colors.text}"
    textColor: "{colors.bg}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "46px"
  fab-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
  sheet:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.sheet}"
    width: "560px"
---

# Design System

## Overview

**Creative North Star: "The Shelf-Edge Label"**

Shelf is built like the price label on the edge of a shop shelf: the price is the biggest thing on it, the name comes second, and every other fact is small, short and true. It is a single column on a phone, held in one hand, often turned round so the customer reads it too. The ground is near-black, items sit on raised charcoal cards, and one coral marks the thing that is switched on or the item being recommended. A light theme mirrors the same roles on warm off-white for bright shop lighting; it follows the device setting and is not a separate design.

Density is high but not cramped: a stock card shows photo, name, spec, grade, update status, speed and price in about 104px of height, and nothing needs a second screen. Controls are pills, containers are softly rounded rectangles, and depth comes from tone rather than shadow. Recommendations are not a grid of equal cards. They are a ladder: each item is a rung, and the space between rungs says in plain facts what the extra pounds buy or what the saving gives up.

Status is always words with a colour, never a colour alone. Type is the device's own system sans at heavy weights; there is no brand typeface.

**Key Characteristics:**
- One 760px column, phone width first; the desktop view is the same column, centred.
- Near-black ground, two charcoal surface steps, hairline borders; flat at rest.
- One coral accent; green, amber and red belong to status only.
- Price is the largest text on any item and uses tabular figures.
- Pill controls at 38px, fields and main buttons at 52px, icon targets at 44px.
- Every status colour is paired with a dot or icon and a word.
- Dark and light themes share one set of role tokens.

## Colors

A cool near-black and charcoal neutral ramp, one warm coral, and three status hues that are never used for decoration. Token names are the project's own; each has a light-theme counterpart with the same role.

### Primary
- **Counter Coral** (`accent`, #ff5a4f; light `accent-light`, #d93025): the single accent. It fills a switched-on chip and the main action pill, tints the recommended rung, and appears as small marks: the dot after the wordmark, the store pin, the focus ring, the loading bar under the search field, text links, the caret and text selection.
- **Coral Ink** (`accent-ink`, #1a0503; light #ffffff): text and icons on a coral fill.

### Secondary
- **In-Support Green** (`ok`, #3ddc97; light #0b8a5c): still gets updates, grade A, and the tick beside a gain on the ladder.
- **Ending Amber** (`warn`, #ffc247; light #a86400): updates ending soon, grade C, a recently changed price, the minus beside something given up, and the demo-mode notice.
- **Ended Red** (`bad`, #ff7a7a; light #c93636): no more updates.
- **Unknown Grey** (`unknown`, #8d95a3; light #6a7180): update status not known.

### Neutral
- **Stockroom Black** (`bg`, #0c0d10; light #f4f4f1): page ground, sheet ground, and the text colour on inverted controls.
- **Charcoal Surface** (`surface`, #16181d; light #ffffff): cards, chips, fields.
- **Raised Charcoal** (`surface-2`, #1f2229; light #ecece8): the layer inside a card or the header: thumbnails, the store pill, variant lists, neutral tags.
- **Hairline** (`line`, #2b2f38; light #dfdfd9): 1px borders and row dividers.
- **Label White** (`text`, #f3f4f6; light #15171c): primary text, and the fill of inverted controls (solid button, selected chip in a flow, the floating Filters button).
- **Quiet Grey** (`muted`, #9aa2af; light #5d6471): secondary text, placeholders, resting icons.
- **Photo White** (`thumb`, #ffffff in both themes): the pad behind product photos, so they look the same in either theme.

### Named Rules
**The One Coral Rule.** Coral means "this is on" or "this is the one". In search it fills the active filter chips and the one main action. In a recommendation flow the recommended rung owns it, and selected inputs switch to the neutral inverted fill (Label White on Stockroom Black) so nothing competes with the rung.

**The Colour Plus Word Rule.** A status colour never appears without a word beside it and a dot, letter or icon in the same colour. Tints are made from the status colour itself: 15% for a badge, 20% for a grade square, 11% over Raised Charcoal for a detail panel.

## Typography

**Display Font:** none; the body stack is used at heavy weight
**Body Font:** system-ui (with -apple-system, 'Segoe UI', Roboto, sans-serif)
**Label/Mono Font:** none; figures use tabular numerals from the same stack

**Character:** The device's own sans, set tight and heavy for names and prices and plain for facts. It reads as part of the phone rather than as a brand, which suits a tool the customer glances at over someone's shoulder.

### Hierarchy
- **Headline** (760, 23px, 1.15, -0.025em): the two home-screen prompts. Balanced wrapping.
- **Title** (760, 20px, 1.2, -0.02em): the heading of a flow and of the settings sheet.
- **Item title** (700, 16px, -0.01em): product name on a card.
- **Price** (800, 20px, -0.02em, tabular): price on a stock card. 24px on a ladder rung and 27px on the recommended rung. A small 11px "from" sits above it when there are several in stock.
- **Step price** (780, 22px, -0.02em, tabular): the "£25 more" on the ladder rail, followed by the rest of the sentence at 15px in Quiet Grey.
- **Field** (400, 17px): text typed into the search field and the label of the 52px solid button (at 700).
- **Body** (400, 16px, 1.35): default text.
- **Reason** (400, 15px): the gains and losses between rungs, the home-screen promises, and comparison table cells.
- **Control** (550, 14.5px): chips, selects, number inputs, variant rows.
- **Meta** (400, 13px, Quiet Grey): spec lines, result counts, hints, fine print.
- **Badge** (650, 12.5px): status and tag pills, grade letters (at 800).
- **Label** (650, 12px, 0.04em, uppercase, Quiet Grey): the one- or two-word name at the start of a row of filter chips.

### Named Rules
**The Price Leads Rule.** On any item the price is the heaviest and largest text (800 weight), right-aligned, in tabular figures. The recommended rung's price is the largest on the screen.

**The Caps Are For Labels Rule.** Tracked capitals are only for a short row label such as "Budget" or "Needs". A sentence is set as a sentence: 14px, weight 500, no tracking, normal case.

## Layout

One column. The header, filter rows and main content share a 760px maximum width, centred, with a 16px gutter on each side. The header is sticky and holds the wordmark, the store pill, a status line and the 52px search field; categories sit under it as a horizontally scrolling row of chips. There is no multi-column layout at any width: the desktop view is the phone column in the middle of the window.

Rhythm is built on 8px: 8px between cards, between chips and between filter rows; 12px inside a card and between photo, text and price; 6px between badges; 2px between stacked lines of text in a card. Rows of chips scroll sideways with hidden scrollbars when they are filters above results, and wrap when they are on the home screen or in the settings sheet. Rows that scroll are pulled out to the screen edge with a negative gutter so chips slide off the edge instead of stopping short.

The home screen is two stacked sections separated by a hairline, each a headline, a one-line promise and its control, followed by smaller browse chips. A flow puts its input first and the first rung directly beneath it. The page keeps 88px of bottom padding (plus the safe area) so the floating Filters button never covers the last item.

The only width breakpoint is 620px, where the settings sheet stops being a bottom sheet and becomes a centred dialog. Hover styles apply only on devices that hover. Safe-area insets are respected at the top of the header and the bottom of the sheet, the scanner tray and the floating button.

## Elevation & Depth

Flat at rest. Depth is tonal: Stockroom Black, then Charcoal Surface, then Raised Charcoal, each separated by a 1px Hairline. The sticky header is the page colour at 86% opacity with a 16px background blur, so results pass under it without a hard edge.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 12px 40px rgb(0 0 0 / 0.45)`; light theme `0 12px 40px rgb(20 20 30 / 0.18)`): the floating Filters button and the settings sheet, the two things that sit above the page.
- **Pick ring and glow** (`box-shadow: inset 0 0 0 1px var(--accent), 0 10px 28px -12px color-mix(in srgb, var(--accent) 55%, transparent)`): the recommended rung only, with a 10% coral tint on its surface.
- **Pick column rule** (`box-shadow: inset 0 2px 0 var(--accent)`): the top edge of the recommended column in the comparison table, over a 9% coral tint.

### Named Rules
**The Flat Shelf Rule.** Cards, chips and fields carry no shadow. A shadow means the element floats above the page, or that it is the one recommended item.

## Shapes

Two families. Controls you tap to choose are full pills (999px): chips, selects, number inputs, badges, the store pill, the floating button. Containers and anything with the weight of a field are rounded rectangles at 16px: cards, the search field, the 52px solid button and its square scan partner. Things nested inside a card step down to 12px: the photo, detail panels, the variant list, and 44px icon targets. The settings sheet is 24px on its top corners as a bottom sheet and on all corners as a dialog. The grade letter sits in a 24px square with 7px corners.

Borders are 1px Hairline and solid; a dashed border marks an optional or "other" chip. Dots are 7px circles: after the wordmark and inside status badges. Icons are inline line drawings on a 24-unit grid with a 1.8 stroke and round caps, 20px by default, 24px in icon buttons, 16px inside small pills.

## Components

### Buttons
- **Solid button:** Label White fill with Stockroom Black text, 52px high, 16px corners, 17px text at weight 700, label on the left and a chevron on the right. Used for the single main step on the home screen. Presses to 98.5% scale.
- **Icon button:** 52px square, Charcoal Surface with a Hairline border and 16px corners, 24px icon. Sits beside the solid button for the scan alternative. Header icon targets (scan, clear, back) are 44px with no fill.
- **Action pill:** a chip in its coral state used as a small main action ("Done", "Try again", "Find a step up").
- **Text link:** coral, 13px, weight 600, underlined with a 3px offset. Inside a flow header it is Label White instead.
- **Floating Filters button:** fixed, bottom centre, 46px pill, Label White fill, Floating shadow; turns coral when filters are active.
- **Focus:** every control takes a 2px coral outline with a 2px offset.

### Chips
- **Style:** 38px pill, Charcoal Surface, Hairline border, 14.5px at weight 550, 14px side padding. Browse chips on the home screen are 34px and 13.5px.
- **State:** switched on is a coral fill with Coral Ink text. In a recommendation flow, switched on is Label White with Stockroom Black text. Hover moves the border to Quiet Grey; press scales to 96%.
- **Ghost:** transparent, dashed border, Quiet Grey text, for "Other" and "More".
- **Count:** a brand chip may carry its stock count at 12.5px and 60% opacity.
- **Speed bars:** five 3px bars rising from 4px to 12px, lit ones at full opacity and the rest at 28%, shown inside speed chips and badges next to the word.

### Cards / Containers
- **Stock card:** Charcoal Surface, Hairline border, 16px corners, 12px padding. Three columns: 64px photo on Photo White with 12px corners, a text stack (name, spec, grade line, badges), and the price at the right. The whole card is one button; opening it tints the border coral and reveals the detail with a 0.18s fade and 4px drop.
- **Detail panel:** 12px corners, Raised Charcoal mixed with 11% of the status colour, 14px text, with an 11px uppercase run-in name ("Updates", "Speed", "Price") in the status colour.
- **Variant list:** Raised Charcoal, 12px corners, rows at least 52px with hairline dividers: name, grade square, price, external-link icon.
- **Badges:** 24px pills at 12.5px and weight 650. Status badges are a 7px dot plus words on a 15% tint of the status colour. Tag badges ("Your pick", "Cheapest that fits") are Raised Charcoal; on the recommended rung the tag is coral.
- **Pick list:** one bordered 16px container with rows of at least 60px divided by hairlines: name and stock line on the left, 18px price on the right.
- **Loading and empty:** loading is card-shaped blocks at 104px pulsing to 45% opacity, and a 2px coral bar sweeping under the search field. Empty is centred Quiet Grey text, at most 34 characters wide, with one action pill.
- **Notice:** 12px corners, 14% amber tint, primary text colour.

### Inputs / Fields
- **Search field:** 52px high, 16px corners, Charcoal Surface, Hairline border, search icon on the left in Quiet Grey, 17px text, 44px scan and clear targets on the right. On focus the border becomes Label White. The 2px coral bar on its bottom edge is the loading indicator.
- **Number and text inputs, selects:** the chip shape (38px pill, same border and type). Number inputs are about 104 to 110px wide. Selects draw their own small Quiet Grey caret.
- **Filter row:** an uppercase Label, then chips, with 1px by 22px Hairline separators between groups when the row scrolls.

### Navigation
- **Header:** wordmark at 18px, weight 800, followed by a 7px coral dot; tapping it returns to the start. Beside it the store pill (32px, Raised Charcoal, coral pin icon, 13.5px at weight 600) opens settings. A 13px tabular status line sits at the right ("200 in stock · 41 ms").
- **Flow header:** a 44px back chevron, a Title, and optionally a text link at the right.
- **Settings sheet:** slides up 40px over 0.22s onto a 55% black backdrop, 560px maximum width, 86% of the viewport height at most. Title on the left, coral "Done" pill on the right, then wrapped filter rows.

### Price Ladder
The signature component. Rungs are stock cards in an ordered list. Between rungs a step sits on a 2px vertical rail (primary text colour at 30%) with a 10px ring marker; its head reads the Step price and then what it is measured against, and beneath it a list of facts at 15px. Gains take a green tick, things given up take an amber minus and a hidden "Gives up:" prefix for screen readers. Exactly one rung is the pick: coral ring, 10% coral tint, coral tag, soft coral glow, and a 27px price. In Step up each option has its own short rail, because each is compared with the customer's pick and not with the option above it. When the budget or the phone changes, rungs slide to their new order over 0.3s (`cubic-bezier(0.16, 1, 0.3, 1)`).

### Comparison Table
A compact side-by-side table under the ladder: 15px tabular text, hairline row dividers, row names in Quiet Grey at the left. Column heads carry a small 13px line ("Your pick", "£25 more") above the item name. Cells are Quiet Grey by default; the best value in a row is primary text at weight 720. The recommended column has a 9% coral tint and a 2px coral top rule. The table scrolls sideways edge to edge when it is wider than the screen.

### Barcode Scanner
A full-screen dialog: camera view on black at the top, a scrolling row of chips for camera actions, and a tray of scanned stock cards beneath. Marks over the camera image use fixed colours because they sit on video and not on a theme surface: a green outlined box with a green name pill for a matched label, white for one still being looked up.

## Do's and Don'ts

### Do:
- **Do** use the role tokens (`--bg`, `--surface`, `--surface-2`, `--line`, `--text`, `--muted`, `--accent`, `--accent-ink`, `--ok`, `--warn`, `--bad`, `--unknown`) so both themes follow; build tints with `color-mix` from those tokens.
- **Do** make the price the largest, heaviest text on an item, right-aligned, in tabular figures.
- **Do** pair every status colour with a word and a dot, letter or icon.
- **Do** keep one recommended rung per ladder, and give selected inputs the neutral inverted fill on that screen.
- **Do** keep tap targets at 44px for icons, 52px for fields and main buttons, and 38px for chips.
- **Do** separate layers with tone and a 1px Hairline: page, Charcoal Surface, Raised Charcoal.
- **Do** keep movement short (0.08s press, 0.12 to 0.22s state changes, 0.3s reorder) and switch all of it off under reduced motion.

### Don't:
- **Don't** add a second accent hue, or use green, amber or red for anything that is not a status.
- **Don't** put coral on selected inputs in a recommendation flow, or on more than one rung.
- **Don't** show a status as a colour alone.
- **Don't** set a sentence in the tracked uppercase Label style.
- **Don't** put a shadow on a card, chip or field at rest.
- **Don't** split the page into columns; wider screens get the same single column, centred.
- **Don't** place product photos directly on a theme surface; they sit on Photo White.
