# In your hands — five moves where the device already knows the thing

- **Status:** Live (its ADR is Accepted; H-70 decided 2026-09-07: a and b yes, c declined; slices 19a, 19b, 19d and 19e open, 19c dropped)
- **Date:** 2026-09-07
- **ADR:** [20260907-in-your-hands](../../../architecture/decisions/20260907-in-your-hands.md)
- **Published:** https://claude.ai/code/artifact/63c1aaf1-8263-4ad0-8243-66c07654560a

The twelfth design canvas, and the second look at the 2026-09-07 brief: another look at the design;
clever decisions that are delightful and elegant; think Apple, in animations and features.
[Nothing from nowhere](../20260907-nothing-from-nowhere/README.md) answered the half about
animation the same day and holds H-69. This canvas answers the other half, features, and finds the
same shape of gap. Read against what Apple's features are — the device using a fact it already
holds, then getting out of the way — the running app asks for a password on a phone that knows its
owner's face, sends a link or hands paper to a diver standing at the counter, photographs a card and
then has the card typed, sets its own type size on a phone whose owner already chose one, and can be
installed without ever saying so. This canvas argues one rule, **where the device already knows a
thing, DiveDay uses it, says where it came from, and leaves the last tap to a person**, and applies
it in five moves. **Nothing here is normative**; the ADR carries the decisions, three of them are the
owner's, and code obeys the ADR.

## Artboards

Two pages. The first argues; the second shows.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the five findings, the five moves, the four-part rule with what renders when it fails, the owner's three calls, what already works this way, what is left alone |
| `Door.dc.html` | Move 1 at 390 in three frames: sign-in on Keiko's iPhone, which holds a passkey (one button, the phone's own sheet); sign-in on a device without one (the form as it ships); Settings → Security with the passkey panel; then the table of what changes at each door and what holds it in code |
| `Counter.dc.html` | Move 2 at 390 in four frames: Priya Sharma's blocked row with *Sign here* as its third door; the device turned to face her on the waiver's sign step; the locked desk asking for a staffer back; the counter reopened with her row ready; then what the signature records, where the door is offered and never is, and H-70 b |
| `Card.dc.html` | Move 3 at 390 in three frames: Grace Mensah's self-declared row with the verification form open and the camera at its top; the card in the platform's viewfinder; the four fields filled and marked *Read*; then what the reading may fill and never touches, H-70 c, and why text rather than a scanner |
| `Device.dc.html` | Moves 4 and 5 side by side: the roll-call row at three text settings with the rule under it; the home-screen line under the day as Android and iPhone each draw it, and when it renders and never does |

`canvas.json` lays the boards out on two pages and pins five notes.

## The fiction every board holds to

The same one as every canvas since Clearwater. **Blue Mantis Divers**, Key Largo, boats *Mantis II*
and *Skiff*, default crew Keiko Tanaka and Sal Moretti; Dana Reyes owns the desk. **Thursday, August
27, 2026**, read at three moments:

- **Keiko's own iPhone**, which holds a passkey for her account since August 20; the front desk
  iPad holds one since August 3 (`Door`).
- **6:43 AM at the counter**, the 7:00 Two-Tank Reef on Mantis II at 6 of 10 here: Hugo Marsh and
  Ben Okafor still to come, Priya Sharma with no waiver sent, Grace Mensah's Advanced card waiting
  for verification, as the earlier canvases recorded them. Dana hands the iPad to Priya at 6:43; Priya
  signs at 6:44; the line reads 3 to come, 1 can't board yet (`Counter`).
- **6:46 AM on Grace's record**, her self-declared Advanced card, number 2203 8871 04, photographed
  and read (`Card`). The card drawn in the viewfinder is invented and belongs to no agency.
- **6:58 AM at the rail**, the manifest row drawn at three text sizes: Hugo Marsh aboard, Priya Sharma
  and Grace Mensah still ashore; and **Keiko's first sign-in on her phone**, for the home-screen line
  (`Device`).

Every name, number and time is demo-seed fiction. Nothing here is real customer data.

## What every board keeps

Reef's tokens, radii, type ladder and bed; Geist as the only face on a staff surface; the waiver
page in DiveDay's own tokens, because the shop's brand may never reach it; the door's anatomy and its
one primary (ADR 20260827-first-light); the safety floor (44px targets, 16px critical text, AA, never
colour alone); the coral count of three, which on the boards is spent only as the mark's smallest bubble in the DiveDay
wordmark, one of the three sanctioned appearances (the cover's mark and the three owner-call badges are the
canvas's own chrome, as on every cover since Reef); and every ban. No board is a manifest, a cert *check*
or a payment, and the one roll-call row the Device board draws is there for its size alone: the Card board is the certification form
whose primary is the shipped human tap, and the Counter board's waiver page is the diver's own as it
ships. The platform's passkey sheet and camera sheet are drawn only to show where the glance happens;
DiveDay draws nothing of them. The motion any move takes (the settled row's wash, the door's arrival)
is the sibling canvas's physics and is not redrawn here.

## Decided, and one board corrected

The owner ruled on 2026-09-07 (H-70): passkeys and the step-up, **yes**; the release signed on the
shop's device, **yes**; the card reader, **declined** — "we should have no photo upload". The
decline also corrected the board. The Card board and the cover's third finding say *Capture for
review* already lands a photograph of the card on the record. It does not: that label is the
typed add-certification form's own submit, and a card has carried no image since
[20260811-retire-the-digital-card](../../../architecture/decisions/20260811-retire-the-digital-card.md)
dropped `card_image_url`, for the reason the owner restated. Nothing on the certification form
changes, no photo capture is added, and slice 19c is dropped in full. The board stands as the dated
argument, wrong premise included; a canvas is never freshened after its ADR is decided.

## Known deviations, on purpose left in

- **The Counter board draws the counter at 390.** The counter is an iPad on a stand and is captured
  at 820; the four frames needed room to sit side by side, and the last canvas drew the same surface
  at 390 for the same reason.
- **The Counter board invents the waiver page's title and consent sentence** ("Your waiver for
  Thursday's Two-Tank Reef"; "By typing your name you agree…"). The release's words are H-01's and the
  bundle's; the board needed a sign step for the hand-over line to sit on.
- **The Card board names PADI in the filled Agency field.** The app's own agency list carries it;
  no logo is drawn and the card in the viewfinder names no agency.
- **The Device board draws the roll-call row in isolation** rather than the whole manifest at three
  sizes, so the three settings can be compared in one column.

## Slices

**A canvas has authority over a surface only while that surface's slice is `open`**
([design-artifacts.md](../../design-artifacts.md)). Slice bodies, dependencies and the review each
one takes are in the ADR and in [roadmap.md](../../../product/features/roadmap.md) section 19. Each
row ends with the standing obligation: the component that must not drift names this ADR in its doc
comment, and a test pins the rule.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 19a — the door knows your face: Better Auth's passkey plugin and its table, the passkey frame on `/sign-in`, the Passkeys panel in Settings → Security, the origin-binding test; the step-up half per H-70 a | open | — | — |
| 19b — hand it over: *Sign here* on the counter's and the roster's blocked row, the session lock read by `requireShopSurface`, the hand-over and who-sees-what lines on the waiver page, the counter provenance on the signature row (H-70 b) | open | — | — |
| 19c — point the camera at the card: the reader, the *Read* marks, the date field, the Textract opt-out step, the `/privacy` sentence (H-70 c declined 2026-09-07; the board's premise was wrong, see "Decided" above) | dropped | — | — |
| 19d — the type follows the phone: the `-apple-system-body` probe in the pre-hydration script, upward only, the manifest captured at the largest root | open | — | — |
| 19e — on the home screen: the one line under the day's spine with the platform's install prompt or its own menu item, the device-kept dismissal, nothing when installed or on a desktop | open | — | — |

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first. The prompt below is self-contained; replace the slice id.

```text
Implement slice 19e of ADR 20260907-in-your-hands. Read, in this order: the ADR at
docs/architecture/decisions/20260907-in-your-hands.md (decision 1's four tests and decision 6), the
slice's row in docs/product/features/roadmap.md section 19, the current code the slice touches
(src/app/shop/[shopSlug]/_components/today/DaySpine.tsx, src/app/manifest.ts, the device-kept
preference pattern in src/components/WaterLocker.tsx, and docs/design/principles.md section 3), and
only then the artboard docs/design/canvases/20260907-in-your-hands/Device.dc.html. The ADR outranks
the artboard; shipped code outranks a drawing for any slice already marked shipped in the README's
slice table. Add one row under the day's spine, rendered only on a phone or tablet in a browser tab,
for a staffer whose role reaches the manifest, on a device that has never dismissed it: on a platform
that fires beforeinstallprompt, a secondary button that calls the saved prompt; otherwise the
sentence naming the platform's own share menu with the share glyph drawn inline and one dismissing
link. Render nothing when display-mode is standalone, on a desktop, in an embed, or after a
dismissal, which is kept per device the way boat mode keeps its own. No coral, no drawing, no motion.
Every sentence lands in en-US and es-ES in the same change. The component names the ADR in its doc
comment and a test pins that it renders nothing when installed or on a desktop. Update the README's
slice table row to shipped with the file and the pinning test, run pnpm check:design-canvases,
pnpm test:changed, pnpm lint and pnpm typecheck, look at the home on a phone in light and dark, and
open a pull request explaining any visual diff.
```

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (every artboard on both pages, `canvas.json`, the title "In your
hands"), check it, and republish to the URL above. The seeded output is build output and is never
committed ([design-artifacts.md](../../design-artifacts.md)).
