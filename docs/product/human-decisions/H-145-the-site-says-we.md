# H-145: Who is "I" on the public site?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**Two builder's notes spoke in the first person singular: "I left it out on purpose" on `/` and "I wrote the trial…" on `/pricing`.** `/about` says "we" and names nobody (H-99). The 2026-10-22 market sheet (item 7, call 1) asked: say "we", or put a name on the site, which would also change `/about` (H-66).

## Decision

**Decided 2026-10-22 (Aaron Buxbaum, in the project thread, the recommended option): the site says "we" and names no person.**

## What shipped

`marketing.home.steps.check.note2` reads "We left it out on purpose" (es-ES "Lo dejamos fuera a propósito"). The `/pricing` line went with the margin note that carried it (item 8 deleted `notes.note4`). The builder's-note rule in [docs/design/brand.md](../../design/brand.md) now says the first person is "we", and `src/lib/marketing.test.ts` refuses a first-person singular in any en-US `noteN`.

## Unblocks / follow-up

H-99 (the about page's voice), H-66 (the founder's background, still off the marketing pages).

Part of the [human decision log](README.md#decision-register).
