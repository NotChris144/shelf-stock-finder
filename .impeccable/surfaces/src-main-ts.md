---
version: 1
slug: "src-main-ts"
primary_target: "src/main.ts"
related_targets: ["src/flows.ts","src/styles.css"]
---

# Home and sales flows

Scope: the home screen (no search active) and the two recommendation flows it opens: Step up and Match a budget. Mode: Operate. The staff member is mid-conversation; the customer often reads the result screen.

Job: turn "I want this phone" or "I've got £150" into a specific in-stock item plus a factual reason to spend a little more.

Constraints: phones and tablets only; in-stock only; every reason must be a fact about both items; wording safe to show a customer; one hand, phone width first.

Memorable moment: the price ladder, where each rung says what the extra pounds buy.

## Direction contract

THESIS: A price ladder, not a product grid. Each recommendation is a rung, and the space between rungs states what the extra money buys in plain facts. It refuses the three equal pricing cards with a "most popular" ribbon.

OWN-WORLD: Inherits Shelf as built: near-black ground, raised charcoal surfaces, one coral accent used only for the chosen action and the recommended rung, system sans, pill controls, 16px card radius, green/amber/red status dots always paired with words. New parts: a vertical rail joining the rungs with the step price set on it, and a compact side-by-side table with the best value per row marked.

STORY: The visitor sees what they asked for, sees that a little more buys something concrete, and picks a rung.

FIRST VIEWPORT: Search bar on top as now. Below it two doors stacked on a phone: "They've picked a phone" and "They've given a budget", each with a one-line promise. Door 1 is one solid button plus a scan button. Door 2 is the row of budget amounts themselves, so a single tap on a price lands on the ladder (PRODUCT principle 5, seconds not screens). Browsing categories and recent searches sit under them, smaller. In a flow, the first viewport is the input (one field or one row of price chips) with the first rung visible beneath.

FORM: Brief-specified structure, so no concept round and no seed key. The user's words: "when I open this website, if I'm not already on something, it will be split into like two options and then just like a straight search option as well"; and for the budget flow, "something that's within their price range, something that's really low in their price range... and then something that would be above their price range, but it should be like a compare list". In Step up every option is measured from the customer's pick and says so. The step-up limit is a staff setting: it lives in settings and, labelled as such, below everything the customer reads. Signature interaction: choosing a price or a phone redraws the ladder in place, rungs sliding to their new order.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
