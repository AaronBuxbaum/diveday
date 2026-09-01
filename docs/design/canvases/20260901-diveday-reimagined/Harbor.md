# Harbor — the shop's own colours

**In one sentence.** Harbor makes DiveDay a frame and the shop the picture: a shop's own colour, mark, one display face and photographs drive its public storefront and every embed on its own website, while everything that carries a fact — the ledger, the counts, the signal colours, the manifest — keeps DiveDay's ink.

**Why.** Round two started from research rather than taste. Real dive shops (Key Largo's, and the agency portfolios that build for them) have strong, personal identities: ocean blue with one warm accent, underwater photography on every page, a creature for a mark, a wall of badges — PADI 5★, TripAdvisor, Blue Star — and "Book Now" repeated down every page. Every one of those buttons hands the diver to a third-party page that looks nothing like the shop, and the waiver goes to a third tool. **The shop's brand ends at the button.** FareHarbor's answer is a modal over the shop's site and a $10,000-a-year hosted website. Harbor's answer is that the diver never leaves the shop's brand at all, and the hosted storefront is the shop's website, included.

Harbor is an axis, not a fourth taste. Tide, Deck and Reef decide what *DiveDay* looks like — the staff app, the marketing pages, the credit line. Harbor decides whose brand the *diver-facing* surfaces wear, and it composes with any of the three: a Deck staff console can sit behind a Harbor storefront. That is why the pick in the ADR becomes two questions rather than one.

**The tradeoff, honestly.** A shop with an ugly brand gets an ugly storefront, and DiveDay's own brand becomes nearly invisible to divers — a credit line in a footer, which is the point and also a marketing cost. Reading a host page's font and colour is a heuristic that will sometimes guess wrong, so the generator must show the guess and let the shop override it in one tap. And the badge wall is only as honest as what a shop types into it; DiveDay draws text badges, never a logo it does not have the right to show.

**Three wow moments.**
1. **The mirror** — paste one line on the shop's website and the calendar already looks like the site: the widget reads the host page's font and brand colour, checks contrast against its own sand, and darkens the colour itself if it fails.
2. **The wall** — the storefront's badge wall, review quotes and photographs are first-class objects a shop fills in from Settings, not an afterthought bolted onto a schedule page.
3. **The handover that never happens** — the diver books, signs the waiver and pays inside the sheet on the shop's own site. DiveDay is three bubbles and a credit line.

**Where the brand may never go.** Manifest, roll call, cert check, waiver text, the payment step, and any status. Those keep DiveDay's tokens whatever the shop chose, and the display face never labels an operational fact.

**The embed catalogue, and what ships today.** Today DiveDay ships two snippets: an `<iframe>` of the public schedule and a plain link styled as a button (ADR 20260726-schedule-embed). Round two proposes the catalogue a shop leaving FareHarbor expects, each a one-line paste chosen in Settings: **Button** · **Lightbox** (the sheet over the site) · **Calendar** (inline week ledger) · **Grid** (trips and courses as cards) · **One departure** (a card for a blog post) · **Courses** (a list) · **QR code** (for the counter and the boat) · **Partner link** (a hotel's or a dive resort's referral). Everything but the calendar iframe and the button is tagged *Proposed* on the boards.

**Kept from Clearwater.** The ledger row, group headers owning shared facts, tabular figures, glyph-plus-word states, coral rationed to earned moments, flat-at-rest elevation, and the ban on colour-only status — all of it, under whatever colour the shop chose.
