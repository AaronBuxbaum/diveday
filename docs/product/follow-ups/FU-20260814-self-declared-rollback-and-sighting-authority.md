# FU-20260814-self-declared-rollback-and-sighting-authority — Decide the sighting gate and five smaller calls left open by self-declared cards

- **Status:** Open
- **Raised:** 2026-08-14 — the security-reviewer and dive-domain-expert passes on the self-declared
  certification change (ADR 20260814-self-declared-cards). Every merge blocker either pass found was
  fixed in that change; this is everything they raised that is a judgement call or a product decision
  rather than a defect. Trimmed 2026-08-14 when H-47 closed the rollback question it was named for.
- **Kind:** question
- **Effort:** M
- **Touches:** `src/app/shop/[shopSlug]/divers/[personId]/actions.ts`, `src/lib/dive-declaration.ts`,
  `src/components/DiveDeclarationFields.tsx`, `src/db/self-declared-cards.ts`, `src/i18n/locales/en-US/diver.json`,
  `src/i18n/locales/es-ES/diver.json`

## What I noticed

Six separate things, in descending order of how much they would cost if ignored. The first is the
one a human has to answer; the rest are small and mostly copy.

(A seventh, the rollback hazard this entry was originally named for, was **closed on 2026-08-14**:
H-47 records that the database is disposable pre-pilot, and
[deploy-and-migrations-runbook.md](../../engineering/deploy-and-migrations-runbook.md)
now carries the section that becomes the plan when that expires. The entry keeps its filename so
links to it survive.)

**1. Any staff role can turn a claim into a verified Instructor card.** `reviewAction`
(`src/app/shop/[shopSlug]/divers/[personId]/actions.ts`) gates on `requireStaffSession()` and no role
predicate, so a captain or a deckhand can sight a card. This is **not a regression** — capturing a
card has always been open to every staff role, and the sighting form deliberately mirrors that act —
so it was left alone. But H-14's pattern has been to pull lasting shop-wide authority up to
owner/manager (refunds, diver deletion, erasure), and a sighting is now the single act that converts
a stranger's typing into the state readiness, admission, course prerequisites and the depth advisory
all read. Whether that belongs with the crew is a product-owner call.

**2. There is no "not certified yet" option.** `DECLARABLE_CERTIFICATION_LEVELS`
(`src/lib/dive-declaration.ts`) is the five-rung ladder plus "Rather not say". At a Florida or
Caribbean shop a large share of last-minute-deal joiners are not certified at all: Discover Scuba /
Try Scuba customers, snorkellers, the non-diving half of a couple. Their only honest option is
"Rather not say", which is indistinguishable from a certified diver who skipped — so the shop mails
them a certified two-tank charter. **Critically, "not certified" must not write a `certifications`
row.** A DSD is not a certification, and "DSD certification" is the phrase that costs a dive
business its credibility with instructors.

**3. The ladder cannot hold most non-PADI/SSI cards.** PADI Scuba Diver and Adventure Diver, CMAS
stars, BSAC Ocean/Sports Diver, RAID's numbered levels and GUE Rec 1 have no rung. That is accepted
for a *staff* capture, where a staffer holding the card translates it (the mapping is on the capture
form as `divers.certifications.levelMapping`). Here there is no staffer, and the diver's guess is
stamped onto their record permanently.

**4. `sightedIdentifier` has no shape check.** `sightingSchema` bounds it to 2–120 characters, so
"xx" passes. This is the field that converts a claim into evidence.

**5. Bundled nitrox has no card to sight.** A RAID or GUE diver's nitrox is part of their level
certification, so there is no standalone EANx card — the staffer has to enter the level card's
number on the nitrox sighting form. `divers.certifications.sightCardHint` ("Type what the card in
your hand says") does not tell them that is allowed.

**6. "Dive profile" already means something else.** To a diver, a dive profile is the depth/time
curve of a dive. `DeclaredDiveProfile` (`src/db/self-declared-cards.ts`) and the
`common.diveProfile.*` message namespace use it to mean "what a diver can dive". Nothing user-visible
says the phrase today — the diver sees only "Certification level" — so this is naming, not copy. It
is one careless heading away from being a real credibility error.

## Why it isn't already done

Item 1 is a decision, not a defect: an authorization policy call of the kind H-14 has
consistently reserved for the product owner. Item 2 is the largest and needs both a product call
("do we want to know who is uncertified?") and a data-model call (a "not certified" answer that
writes no `certifications` row needs somewhere else to live). Items 3–6 are small but were all
outside the security repair the session was scoped to.

## Proposed change

**1 (sighting authority):** an H-row in `docs/product/human-decisions.md`. Under "yes, narrow it",
add `canPersonSightCard` to `src/db/authz.ts` mirroring `canPersonRefund`, gate `reviewAction`'s
sighting branch on it (not the one-tap review branch, which stays open), and say so on the form.
Under "no", record the reasoning in the ADR so the next reviewer does not re-raise it.

**2 (not certified yet):** add a `not_certified` option to the *form* only, as a value the schema
accepts and `recordSelfDeclaredCards` explicitly refuses to turn into a card. Where the answer lands
instead is the open question — a column on the list entry contradicts the ADR's "the person is where
a certification lives" reasoning, but that reasoning was about *certifications*, and this is the
statement that there is not one. Do **not** add a rung to `CertificationLevel`.

**3:** copy only. A hint under the select ("Not sure which? Pick the closest — the shop checks your
card anyway") plus equivalence hints on the two rungs that carry most of the traffic. Both locales.

**4:** raise `sightingSchema`'s minimum to something a real card number satisfies, or add a
loose shape check. Do not over-constrain — agencies vary widely.

**5 and 6:** copy and a rename respectively. The rename is mechanical but touches a message
namespace, so it wants its own change rather than being buried in another.

## Prompt

```text
Work through docs/product/follow-ups/FU-20260814-self-declared-rollback-and-sighting-authority.md.
It collects six items a security-reviewer and a dive-domain-expert raised against the
self-declared certification feature that were judgement calls rather than defects; every actual
blocker they found is already fixed and merged.

Read first, in this order:
  - docs/architecture/decisions/20260814-self-declared-cards.md (the invariants; read the
    anti-displacement section carefully, it has a subtle predicate)
  - src/db/self-declared-cards.ts and its test
  - src/lib/dive-declaration.ts and src/components/DiveDeclarationFields.tsx (items 2, 3)
  - src/app/shop/[shopSlug]/divers/[personId]/actions.ts (items 1, 4)

Item 1 is a question for the product owner, not yours to close: open the H-row in
docs/product/human-decisions.md and stop. Items 3, 4, 5 and 6 are small and can be done directly.
Item 2 is the one with real design in it —
a "not certified yet" answer must NOT write a certifications row, because a Discover Scuba
experience is not a certification and calling it one is the kind of error a dive professional
notices immediately.

Constraints that make this non-obvious:
  - Any string a person reads goes in src/i18n/locales/<locale>/, in BOTH en-US and es-ES in the
    same change (pnpm check:locale). Read src/i18n/locales/es-ES/README.md before writing Spanish.
  - Adding a certification level is a schema enum change and is almost certainly the wrong answer
    to item 3 — the five-rung ladder is asserted against by trip-admission.ts.
  - A claim must never become evidence without a card sighting. Do not weaken that while adding
    options to the form.

Done when: the chosen items are implemented with tests, both locales pass pnpm check:locale, and
pnpm check is green; and the items you did NOT do are still described accurately in the file (or
the file is deleted if you did all of them).
Deleting a follow-up entry is how it is closed — never mark it done in place.
```
