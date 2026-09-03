# The maker is the proof — the marketing pages, one big loop

- **Status:** Live (its ADR is Proposed; two decisions wait on H-66)
- **Date:** 2026-09-02
- **ADR:** [20260902-the-maker-is-the-proof](../../../architecture/decisions/20260902-the-maker-is-the-proof.md)
- **Published:** https://claude.ai/code/artifact/e9622fd1-7bf9-4097-b104-d48c6b7ccb2e

The eighth design canvas, and the first about the marketing pages. The owner's brief: take a big
loop over the pages and the copy, evaluate, make changes, and find a differentiator — naming a
support staff and his own work background (ex-Google) as candidates. Three notes in the same
session reshaped it: the copy has to sound like a person wrote it; nothing may read as a side
project, imply one person builds DiveDay, or say "I"; and the case is about what DiveDay does and
who is here, with the background as one passing clause rather than a rundown. Every page was read
as it renders today (light and dark, 1280 and 390) against
[marketing.md](../../../product/marketing.md)'s rulebook. **Nothing here is normative**; the ADR
carries the decisions, and two of them are the owner's.

## Artboards

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: what is working, the four findings, the five moves, the two owner calls, how the background is and is not used |
| `SupportOptions.dc.html` | Finding 3 argued: the support sentence three ways, each rendered as it would land on `/pricing` and `/about`, with motivation and tradeoff; B recommended |
| `AboutBuilder.dc.html` | `/about` at 1280: the shipped header and hero, then the new "Who's here" band — three short paragraphs in team voice — and the head of the rules band that follows |
| `AboutBuilderPhone.dc.html` | The same band at 390 |
| `HomeProof.dc.html` | `/` at 1280, the tail: the records band's hub link, "The short version" (the whole case in five plain sentences), and the shipped close with the contact line's new second sentence |
| `CopyLedger.dc.html` | Every sentence the loop moves — current beside proposed, with the reason and the message key — plus the voice pass: eight tells and one rewritten example from each page |

`canvas.json` lays them out in three rows and pins three notes: the band's sentences are drafts,
Option B sits inside the current policy and still takes the owner's nod, and the short version's
only control is a link.

## The slices

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 15a — `/about` "Who's here" band, three paragraphs in team voice, the background as one clause; "spec" leaves `founderP3` | open | — | — |
| 15b — `/` "The short version" between the records diptych and the close | open | — | — |
| 15c — the support sentence, "one of us reads it", in five places (H-66, Option B) | open | — | — |
| 15d — the voice pass across every marketing page, held to the eight tells | open | — | — |
| 15e — `marketing.md` records parts 3–5 and the shape of the team band | open | — | — |

Each slice runs the `marketing-page` skill end to end: claims checklist, `e2e/marketing.spec.ts`
assertions moved deliberately, both locales in one change, screenshots looked at, a
`conversion-reviewer` pass. 15a carries biography and 15c a promise about who reads the inbox, so
both wait on the H-66 row; 15b, 15d and 15e do not.

## The facts every board holds to

The founder facts confirmed on 2026-07-25 are a software engineer who worked on Google Maps, helped
build a biotech company that went public, and works on self-driving cars, plus the origin: a
conversation with a dive shop owner about what his systems were costing him. **The boards use one
sentence of that and no more** — "One of us used to write software at Google." — because the owner declined both a
signed story and a three-fact ledger as protesting too much. No name, no home location, no
certification year, no second person named, no signature, no "I". The three sentences of the band
are drafts for the owner to keep, reword or strike. The shop on every mockup is the demo fiction,
**Blue Mantis Divers**, and the roll-call phone carries the same Two-Tank Reef manifest the
homepage hero ships today.

## What this canvas leaves alone

The hero of every page, the price hero, the two-doors rule and the pinned control budgets, the
four checkable rules, the three plain truths, the concessions, the switching hub's shape and the
concierge's position, and everything the 2026-08-27 review kept. The voice pass changes sentences
on those surfaces; it changes no composition.
