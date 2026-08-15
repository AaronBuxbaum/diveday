# FU-20260815-no-seeded-diver-ever-declared-anything — Seed one declared level and one "not certified yet", so the marks a shop reads before a blast are ever actually looked at

- **Status:** Open
- **Raised:** 2026-08-15 — shipping `people.no_certification_declared_at` and the "I'm not certified
  yet" option (ADR 20260814-self-declared-cards, amendment 2026-08-15). The gap is older than that
  change: the whole self-declared feature has been unseeded since it landed on 2026-08-14.
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/db/seed.ts`, `src/db/seed-front-desk.ts`, `e2e/last-minute-fill.spec.ts`,
  `e2e/visual.spec.ts`, `src/db/self-declared-cards.ts`

## What I noticed

`grep -rn "declaration\|selfDeclaredAt" src/db/seed*.ts` returns nothing, and `grep -rn
"certificationLevel" e2e/` returns nothing. So:

- **No seeded diver has ever declared anything.** Every person on blue-mantis's last-minute list and
  every wait-list entry renders *"Level not said"*, which is the one branch of
  `certificationSummaryText` that carries no mark and no tone.
- **No e2e ever fills the declaration in.** `DiveDeclarationFields` mounts on the shop-wide
  last-minute form (`/s/blue-mantis#last-minute-list`) and on a full trip's wait-list form;
  `e2e/last-minute-fill.spec.ts` joins the list without touching either control. Nothing exercises
  the one loop that matters — a diver choosing an answer on the public form and a staffer reading it
  on the send list — and nothing exercises the select's own new behaviour, where picking "I'm not
  certified yet" clears and disables the nitrox tick beside it.
- **No visual capture has looked at a marked row.** The warning-toned *"— diver's word, no card"*,
  the *"· below this departure's minimum"* words, and now *"Not certified yet — diver's word"* are
  the entire safeguard on a screen whose Send button mails a discount to everybody on it — and the
  only place any of them has ever been rendered is jsdom, in
  `LastMinuteDealSection.test.tsx` / `WaitlistSection.test.tsx`.

The unit coverage is thorough (`src/db/self-declared-cards.test.ts`,
`src/i18n/certification-summary-labels.test.ts`, `src/lib/last-minute-list.test.ts`), so this is not
"untested logic". It is that nobody has ever *seen* the safeguard, at a real width, in either theme,
in either language — and it is a row of small print beside a name, which is exactly the class of
thing that truncates or goes muted without a test noticing.

## Why it isn't already done

Scope, and honesty about what I could verify. The session that shipped the stamp was told not to run
`pnpm e2e`, `pnpm e2e:build` or `pnpm visual`, so it could neither prove a new spec green nor read
the visual diff that seeding a declaration onto blue-mantis would produce on the guests page. Adding
seed rows I cannot look at, on the demo shop every visual baseline is drawn from, is the change most
likely to land as an unexplained pixel diff for somebody else to triage.

There is also a real product question inside it, which is why this is a `risk` and not a `cleanup`:
the demo shop is a **sales surface**, and `src/db/seed-front-desk.ts` already argues at the row it
seeds `succeeded` that a demo permanently shouting about broken things is a worse demo. One
unverified claim and one uncertified joiner on a list of a dozen is realistic rather than alarming —
but that is a call worth making deliberately rather than by accident.

## Proposed change

1. **Seed two of them, in a new `src/db/seed-*.ts` scenario module** (never wedged into an existing
   one — ADR 20260803-seed-scenario-modules), plus its one line in `src/db/seed.ts`'s orchestrator:
   one last-minute-list joiner with a self-declared `open_water` claim on a departure that asks for
   Advanced, and one joiner carrying `no_certification_declared_at`. Write them through
   `recordSelfDeclaredCards` so the seed cannot drift from the writer's own rules.
2. **One e2e assertion** in `e2e/last-minute-fill.spec.ts`: a diver joins the public list choosing
   "I'm not certified yet", and the staffer's recipient panel shows that name reading *"Not certified
   yet — diver's word"*, above the ten-name cap. That is the whole loop, end to end, and it is the
   one flow where the answer either reaches the person deciding or does not.
3. **One visual capture** of the guests page with the deal panel open, so the tone and the truncation
   behaviour of a marked row are on a baseline.

**Not** proposed: seeding a *verified* card that is below a departure's bar as well (the third mark
is the same words through the same phrase), a `?filter=` to keep the capture small, or anything that
makes the demo shop's list look alarming.

## Prompt

```text
Seed the self-declared certification marks into the demo shop, and cover them with one e2e and one
visual capture. Today no seeded diver has ever declared a level or answered "I'm not certified yet",
and no e2e ever fills that form in — so the marks that are the entire safeguard before a discount
blast have only ever been rendered in jsdom.

Read first:
  - docs/product/follow-ups/FU-20260815-no-seeded-diver-ever-declared-anything.md (this file)
  - docs/architecture/decisions/20260814-self-declared-cards.md, especially decision 4 (nothing
    filters — informing is the design) and the 2026-08-15 amendment
  - src/db/self-declared-cards.ts (recordSelfDeclaredCards, listCertificationSummaries)
  - src/db/seed.ts's orchestrator and any src/db/seed-*.ts for the shape of a scenario module
  - e2e/last-minute-fill.spec.ts and the e2e-and-visual skill

The work: a new src/db/seed-<scenario>.ts with one self-declared open_water joiner and one who
declared no certification, both written through recordSelfDeclaredCards; one line in seed.ts; an
assertion in e2e/last-minute-fill.spec.ts that a public joiner choosing "I'm not certified yet"
reaches the staff recipient panel reading "Not certified yet — diver's word"; and a capture of the
guests page with the last-minute-deal panel open in e2e/visual.spec.ts.

Constraints that make this non-obvious:
  - The demo shop is a sales surface. Two marked rows among a dozen is realistic; a list where
    everybody is unverified is a worse demo, and src/db/seed-front-desk.ts makes that argument at
    the row it deliberately seeds `succeeded`.
  - Never wedge rows into an existing seed scenario (ADR 20260803-seed-scenario-modules).
  - This will move visual baselines on the guests page. That is expected — say why in the PR and
    review every diff image; there is nothing to regenerate locally.
  - Nothing here may filter a blast, reorder the mail, or disable a send.

Done when: pnpm check is green, the new e2e spec passes with pnpm e2e, the visual diff is explained,
and docs/product/follow-ups/FU-20260815-no-seeded-diver-ever-declared-anything.md is deleted as part
of the change.
```
