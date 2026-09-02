# The maker is the proof — the marketing pages, one big loop

- **Status:** Live (its ADR is Proposed; two decisions wait on H-66)
- **Date:** 2026-09-02
- **ADR:** [20260902-the-maker-is-the-proof](../../../architecture/decisions/20260902-the-maker-is-the-proof.md)
- **Published:** https://claude.ai/code/artifact/e9622fd1-7bf9-4097-b104-d48c6b7ccb2e

The eighth design canvas, and the first about the marketing pages. The owner's brief: take a big
loop over the pages and the copy, evaluate, make changes, and find a differentiator — naming a
support staff and his own work background (ex-Google) as candidates — and, mid-loop, make the
copy sound less like a machine wrote it. Every page was read as it renders today (light and dark,
1280 and 390) against [marketing.md](../../../product/marketing.md)'s rulebook. **Nothing here is
normative**; the ADR carries the decisions, and two of them are the owner's.

## Artboards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: what is working, the four findings, the five moves, the two owner calls, how "ex-Google" is and is not used |
| `SupportOptions.dc.html` | Finding 3 argued: the support sentence three ways, each rendered as it would land on `/pricing` and `/about`, with motivation and tradeoff; B recommended |
| `AboutBuilder.dc.html` | `/about` at 1280: the shipped header and hero, then the new "Who builds it" band — the story, told in the third person, beside the three-row ledger — and the head of the rules band that follows |
| `AboutBuilderPhone.dc.html` | The same band at 390, stacked |
| `HomeProof.dc.html` | `/` at 1280, the tail: the records band's hub link, the new echo band in the moment-row shape, and the shipped close with the contact half's added clause |
| `CopyLedger.dc.html` | Every sentence the loop moves — current beside proposed, with the reason and the message key — plus the voice pass: seven tells and one rewritten example from each page |

`canvas.json` lays them out in three rows and pins three notes: the band's sentences are drafts, Option
B sits inside the current policy and still takes the owner's nod, and the homepage's one new control is a link.

## The slices

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 15a — `/about` "Who builds it" band, third person, with the ledger; "spec" leaves `founderP3` | open | — | — |
| 15b — `/` echo band between the records diptych and the close | open | — | — |
| 15c — the support sentence, "read by the people who build DiveDay", in five places (H-66, Option B) | open | — | — |
| 15d — the voice pass across every marketing page, held to the seven tells | open | — | — |
| 15e — `marketing.md` records parts 3–5 and un-retires the biography under part 1's shape | open | — | — |

Each slice runs the `marketing-page` skill end to end: claims checklist, `e2e/marketing.spec.ts`
assertions moved deliberately, both locales in one change, screenshots looked at, a
`conversion-reviewer` pass. 15a carries a real person's name and 15c a promise about who reads the inbox, so both wait on
the H-66 row; 15b, 15d and 15e do not.

## The facts every board holds to

The founder facts are the three confirmed on 2026-07-25 and nothing else: a software engineer who
worked on Google Maps, helped build a biotech company that went public, and works on self-driving
cars; and the origin, a conversation with a dive shop owner about what his systems were costing him.
The name is Aaron Buxbaum, in the prose and in the third person. No home location, no certification
year, no second person named, no signature, and no "I" anywhere — DiveDay is not one person, and
the background is listed without a tense so nothing reads as a side project. The three paragraphs
and the three ledger lines are drafts for the owner to confirm, reword or strike. The shop on every mockup is the
demo fiction, **Blue Mantis Divers**, and the roll-call phone carries the same Two-Tank Reef
manifest the homepage hero ships today.

## What this canvas leaves alone

The hero of every page, the price hero, the two-doors rule and the pinned control budgets, the
four checkable rules, the three plain truths, the concessions, the switching hub's shape and the
concierge's position, and everything the 2026-08-27 review kept. The voice pass changes sentences
on those surfaces; it changes no composition.
