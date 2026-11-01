# H-20261022-the-site-says-we: Who is "I" on the public site?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Two builder's notes spoke in the first person singular: "I left it out on purpose" on `/` and "I wrote the trial…" on `/pricing`.** `/about` says "we" and names nobody (H-20261006-about-say-whose-voice). The 2026-10-22 market sheet (item 7, call 1) asked: say "we", or put a name on the site, which would also change `/about` (H-20260725-founder-background-go-back).

## Decision

**Decided 2026-10-22 (Aaron Buxbaum, in the project thread, the recommended option): the site says "we" and names no person.**

## What shipped

`marketing.home.steps.check.note2` reads "We left it out on purpose" (es-ES "Lo dejamos fuera a propósito"). The `/pricing` line went with the margin note that carried it (item 8 deleted `notes.note4`). The builder's-note rule in [docs/design/brand.md](../../design/brand.md) now says the first person is "we", and `src/lib/marketing.test.ts` refuses a first-person singular in any en-US `noteN`.

## Unblocks / follow-up

H-20261006-about-say-whose-voice (the about page's voice), H-20260725-founder-background-go-back (the founder's background, still off the marketing pages).

Part of the [human decision log](README.md#decision-register).
