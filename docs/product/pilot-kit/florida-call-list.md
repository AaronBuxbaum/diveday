# Ten-shop Florida call list — template and sourcing method

**This file contains no shops.** It is the frame for building the list: why Florida, what makes a
shop worth an hour, what makes one a bad first pilot, where to look them up, and the columns to
fill. The rows are the founder's to research — a list of invented names and numbers would get
dialled, and inventing one is worse than having none.

Target: **ten qualified shops**, enough to open the five conversations
[the 30-day list](../rollout.md#the-next-30-days-in-order) asks for and absorb the shops that say
no. Phase 1 needs two or three to say yes.

## Why Florida, and why one state

Florida is the launch jurisdiction — confirmed by the product owner 2026-07-30 (H-01), no longer a
planning assumption. Every waiver, medical-question, and retention answer the attorney gives is
scoped to it, so a shop outside Florida cannot be piloted on approved paperwork even if it says
yes. It is also year-round, which is the whole reason
[rollout.md](../rollout.md#phase-1--design-partners-septoct-2026) can target a Sept–Oct in-season
pilot at all.

Practical consequence: **a promising out-of-state shop is a Phase 2+ note, not a Phase 1 call.**
Write it down somewhere else and move on.

## Coverage: aim across regions and across profiles

The three deliberate profiles are specified in
[rollout.md](../rollout.md#who-to-recruit--three-deliberate-profiles) — don't re-derive them. A
sensible cut of ten:

| Profile | Slots | What it stresses in the product |
| --- | --- | --- |
| Boat-charter-heavy (daily two-tank trips) | 4 | Manifests, roll call, prep list, the Today queue — the safety spine |
| Course-heavy (steady Open Water pipeline) | 3 | Course catalog, sessions, instructor staffing, waiver/medical on students |
| EVE or DiveShop360 defector | 3 | The importer and the `/switching` guides against a real incumbent export |

Florida's diving is regional and the operations differ by region, so spread the ten rather than
taking ten shops from one town. Reef-and-wreck day-boat country (the Southeast coast and the Keys),
spring/cavern country on the Gulf side and the north-central springs, and the Panhandle each run a
different kind of day. One shop per region is enough to notice if the product only fits one of them.

## Qualification criteria — what earns a call

Score each candidate before dialling. A shop worth an hour has most of these:

1. **Runs its own boat, or books onto a partner boat on a fixed daily schedule.** The manifest and
   roll call are the differentiators; a shop that never assembles a boarding list can't test them.
2. **Enough volume that the morning is chaotic** — more than a handful of divers on a typical
   departure, and more than one departure some days.
3. **A named owner or manager reachable directly.** A shop where the decision needs a regional
   office is not a design partner.
4. **Currently on something identifiable** — a named incumbent system, a paper-and-spreadsheet
   process, or a general-purpose booking channel. "We don't know what we use" is a research gap, not
   a qualification.
5. **Publicly visible pain, if you can find it.** A shop owner posting in a public forum about their
   current software is a warm opening; per the etiquette rule in
   [commercial-and-industry.md](../stakeholders/commercial-and-industry.md), you reply to their
   named problem with specifics — you never broadcast.
6. **Reachable in person.** Phase 1 is high-touch and the founder is present for the first boat day;
   a shop you can drive to is worth more than a better one you can't.

## Disqualifiers — do not open a Phase 1 conversation with these

These are not judgements about the shop; they are places where DiveDay would fail them, and finding
that out in week two of a pilot is the expensive way.

- **Retail POS is the centre of the business.** DiveDay concedes retail POS, agency (PADI) sync, and
  gear inventory outright ([marketing.md](../marketing.md)). A shop whose day is the till will be
  disappointed, honestly and correctly.
- **Multi-location operation.** Out of scope and explicitly unclaimable under the claims policy.
- **The shop needs agency-roster sync.** No agency exposes a usable C-card verification API; staff
  verification is manual by design (H-10, dropped).
- **A Spanish-first shop, for now.** The diver bundle's Spanish translation has not had its native
  review (V-06), and the waiver, the medical questionnaire, and `/ready` are still English pending
  H-01/H-03 — the shop would meet a language seam at exactly the wrong page.
- **A shop that wants a signed contract this week.** There is no entity and no contract set yet
  (H-18); a pilot agreement cannot be signed until that closes. A shop willing to talk now and sign
  when the paperwork exists is fine — one that needs paper first is a Phase 2 call.
- **A shop whose fill station would go into DiveDay on day one.** The nitrox parameters are approved
  policy but unreviewed in the field (V-05).

Record the disqualifier when you park a shop. A parked list with reasons is a real asset once H-18
and V-05/V-06 close; a parked list without reasons is a deleted afternoon.

## Where to source candidates (public, verifiable)

Work top to bottom; the first two give near-complete coverage and the rest add context.

1. **The PADI dive-shop locator and the SSI dive-centre locator**, filtered to Florida. Between them
   this is close to a complete public list of affiliated shops, with the shop's own published
   contact details. NAUI and SDI/TDI locators catch shops the first two miss.
2. **The shop's own website.** This is where the profile is decided: a published daily two-tank
   schedule with departure times says boat-charter-heavy; a course calendar with Open Water dates
   says course-heavy; an online booking widget names the channel or system they're on.
3. **Their booking flow, clicked through as a diver** (stop before paying). It shows you what their
   diver actually experiences, whether waivers are digital, and often which vendor is behind it.
4. **ScubaBoard's dive-shop-software threads.** The same threads the
   [competitive research](../assessments/competitive-strategy.md) mined for incumbent complaints —
   shop owners describing their own pain in public, by name.
5. **Facebook dive-industry groups** (shop-owner and dive-professional groups) for the same signal.
6. **Charter and dive-site directories, and the dive-boat listings around a given port** — useful for
   finding operators whose web presence is thin but whose boat runs daily.
7. **Scubanomics / Business of Diving Institute** for the business-of-diving context, and **DEMA's
   member directory** once membership happens (item 7 on the 30-day list).

**Warm beats all seven.** Shops the founder already dives with, and introductions from them, outrank
any directory row: a pilot needs trust more than reach.

## The columns to fill

Keep the filled list **outside this repository**. It will accumulate owner names, mobile numbers,
and notes on people's businesses; none of that belongs in a git history, and the repo's standing
rule is that personal data does not enter it. A spreadsheet or a CRM is the right home. Use only
contact details the shop has published for business use.

| Column | What goes in it |
| --- | --- |
| Shop | Legal/trading name as they write it |
| Region | Which of the Florida regions above — for coverage, not geography trivia |
| Profile | `boat` / `course` / `defector` — the pitch changes, so decide before dialling |
| Why this shop | One line. If you can't write it, it isn't qualified yet |
| Current system | Named incumbent, booking channel, paper, or unknown — and how you know |
| Boat? | Own boat / partner boat / none, and typical divers per departure if published |
| Decision-maker | Name and role, if publicly listed. Blank is fine; guessing is not |
| Contact route | Published business phone / email / dock visit / warm intro via whom |
| Source | The URL or the person the row came from — so the next pass can re-verify |
| Researched | Date you did the lookup; anything older than a season needs a re-check |
| Status | `to research` / `to call` / `called` / `meeting` / `pilot` / `parked` |
| Disqualifier | Which one from the list above, if parked |
| Last contact | Date and channel |
| Next action + date | One action, one date. An empty next action means the row is dead |

## Before you dial

- Read the shop's own site and their booking flow first — the
  [first-call script](first-call-script.md) opens with something specific about *their* operation,
  and that only works if you did the reading.
- Have the [one-pager](../stakeholders/design-partner-one-pager.md) and the insurer answers
  ([insurance.md](../stakeholders/insurance.md)) to hand; "does this affect my coverage?" arrives
  early.
- Have the demo shop open on your phone, but don't lead with it — call one is
  [discovery](first-call-script.md), and a demo answers a question nobody asked yet.
- Know what you can and cannot promise: the offer as written in
  [rollout.md](../rollout.md#the-offer-write-it-down-say-it-the-same-way-every-time), the price
  spoken from the live pricing page, and nothing improvised.
