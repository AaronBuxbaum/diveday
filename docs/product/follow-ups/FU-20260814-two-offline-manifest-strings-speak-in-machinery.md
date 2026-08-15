# FU-20260814-two-offline-manifest-strings-speak-in-machinery — Rewrite the offline-manifest capability line in the captain's register

- **Status:** Open
- **Raised:** 2026-08-14 — noticed while reading the offline roll-call marketing strings end to end for FU-20260812-offline-roll-call-copy-overstates-the-crew-half. Unrelated to that entry's subject, which is accuracy; this one is voice.
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `docs/design/principles.md`

## What I noticed

One shipped diver-facing string describes the offline boat manifest in implementation vocabulary
rather than in what a captain would see or say.

`marketing.capabilities.diveDay.item3` reads:

> An encrypted offline manifest, reconciled when signal returns

`docs/design/principles.md` section 4 (the captain's register) rules this out: marketing copy says
what the screen does, not what the machinery is. Both nouns here are machinery. A dive shop owner
reading a capabilities list does not buy "reconciliation" — they buy knowing that the count on the
boat and the count at the counter end up the same, and that nobody has to remember to make that
happen.

"Encrypted" is a **true and good** fact about the product, and this entry is not an argument for
dropping it. It is an argument that a capabilities line about a head count is the wrong place for
it: a buyer meets that word here as jargon, where the same word on a privacy or security surface —
where they are actually asking who can read their divers' data — is reassurance.

The string is not inaccurate, which is why this is an improvement and not a risk. Nothing about it
is unsafe and nothing about it blocks anything.

## Why it isn't already done

Outside the scope of the change that surfaced it, twice over. That change was scoped to the accuracy
of a safety claim, and it has since been superseded entirely: the owner decided on 2026-08-14 to
**build** the offline crew roll call rather than narrow the copy, so the strings that entry named
are now acceptance criteria rather than edits. This string was never one of the four, and its
problem — register, not truth — survives that reversal untouched.

It also carries a judgment call that deserves its own look rather than a drive-by: whether the
encryption fact should be **relocated** to the privacy or security copy, or simply **dropped** from
a capabilities line. Deleting a true differentiator to fix a voice problem would be a bad trade made
quietly, and it is the kind of call that should be visible in its own diff.

## Proposed change

1. Rewrite `marketing.capabilities.diveDay.item3` in the captain's register — what the screen does.
   Something in the shape of *"The manifest on the phone, and the counter's copy, agreeing when you
   get back in range."* Match the surrounding `capabilities.diveDay.*` items for length and rhythm;
   they are a scannable list, not sentences.
2. Decide deliberately where the encryption fact goes. Relocating it to the privacy or security copy
   is the recommendation; dropping it outright needs a reason stated in the PR. Do not silently
   delete it.
3. Both locales in the same change. For `es-ES`, read `src/i18n/locales/es-ES/README.md` first, and
   reuse the vocabulary already shipped in `src/i18n/locales/es-ES/staff/shared.json`
   (`offlineManifest.single.*`) so the marketing pages and the dock screen keep saying the same
   thing in the same words.

Check the timing before starting: if the offline crew roll call (FU-20260812) has landed, the crew
half of a head count is recordable with no signal and the surrounding copy will have moved. Read the
neighbouring strings as they are then, not as this entry found them.

I am specifically **not** proposing changes to the four strings FU-20260812 names as its acceptance
criteria, and not proposing removing the offline claim from anywhere.

## Prompt

```text
Rewrite one shipped marketing string so it speaks in the captain's register instead of in
implementation vocabulary.

Read first:
  - docs/design/principles.md section 4 (the captain's register)
  - src/i18n/locales/en-US/diver.json, key marketing.capabilities.diveDay.item3, and the sibling
    capabilities.diveDay.* items around it for length and rhythm
  - src/i18n/locales/es-ES/README.md, and the shipped wording in
    src/i18n/locales/es-ES/staff/shared.json under offlineManifest.single.*
  - the brand-voice and i18n-copy skills

The string reads "An encrypted offline manifest, reconciled when signal returns". Both nouns are
machinery a dive shop owner does not buy. Rewrite it as what the screen does — the boat's count and
the counter's count agreeing once you are back in range.

The encryption fact is TRUE and worth keeping somewhere. Decide deliberately whether to relocate it
to the privacy or security copy, where a buyer is actually asking who can read their divers' data,
or to drop it from this line. Say which you chose and why in the PR. Do not silently delete it.

Update es-ES in the same change; it must be a real translation of the new meaning, not a copy of the
English.

Check first whether FU-20260812 (offline crew roll call) has landed — if it has, the neighbouring
offline copy has moved and you should read it as it is now. Do not touch the four strings that entry
names as its acceptance criteria.

Done when: pnpm check:locale and pnpm check are green, and the visual diff for the marketing surface
carrying the capabilities list is triaged and explained in the PR. Delete
docs/product/follow-ups/FU-20260814-two-offline-manifest-strings-speak-in-machinery.md as part of
the change.
```
