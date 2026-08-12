# FU-20260812-offline-roll-call-copy-overstates-the-crew-half — Narrow the shipped offline roll-call claims to the diver half, which is the half that works

- **Status:** Open
- **Raised:** 2026-08-12 — drafting `docs/product/pilot-kit/cold-email-template.md`; a `dive-domain-expert` review of the email's offline sentence found the public pages already say more than the product does
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/i18n/locales/en-US/diver.json`, `src/i18n/locales/es-ES/diver.json`, `src/components/OfflineManifestView.tsx`, `docs/product/marketing.md`, `docs/product/pilot-kit/v-02-field-test-run-sheet.md`

## What I noticed

Four shipped diver-facing strings say roll call works offline. The diver half does; **the crew half
does not**, and a checkpoint needs both.

`src/components/OfflineManifestView.tsx` is unambiguous about it, in two places:

> The crew half does not: neither the attestation nor a per-person crew result is recordable
> offline in this slice, so the snapshot is the only crew evidence a dock copy has […] A checkpoint
> with every diver counted and the crew uncounted therefore reads *open* here exactly as it does
> online.

> The crew half of the head count, read-only on the dock (DOM-H1). Divers can be counted with the
> radio off; crew cannot, in this slice.

So offshore, radio off, an after-dive checkpoint **cannot be closed** unless the crew results were
already in the snapshot. That is the one checkpoint where a person may still be in the water. The
strings that overstate it:

| Key | What it says |
| --- | --- |
| `marketing.pricing.faq.offline.answer` | "**Yes.** […] Departure and after-dive roll calls work from that copy" |
| `marketing.features.diveDay.item5` | "roll call keeps working with no signal — **every dive**" |
| `marketing.about.heroDescription` | "roll call works on a phone with no signal" |
| `switching.spreadsheet.wedge.manifestHeadCount.body` | "roll call keeps going when the signal doesn't" |

`es-ES` carries the same claims. `docs/product/marketing.md:102` also presupposes the claim in the
claims policy's own hero guidance ("roll call working offline" listed among the parts a shop's
season depends on), so the rulebook currently authorizes the thing it should be bounding.

This is not the V-02 embargo question. The product owner has said (2026-08-12) he is comfortable
asserting offline operation and wants to settle field verification separately — that is his call
and this entry does not reopen it. This is narrower and it survives that decision: **the crew
sentence is inaccurate about a safety surface regardless of what V-02 finds**, because it describes
behaviour the code deliberately does not implement.

## Why it isn't already done

Out of the scope I was given (drafting an outreach email), and too large to bolt onto it. It is
four strings across two locales plus a claims-policy line, it is safety-adjacent copy so it needs a
`dive-domain-expert` review, and the marketing surfaces carry visual captures, so it wants its own
change with `pnpm check:locale` and a visual triage rather than riding along in a docs PR.

There is also a real product question underneath that I should not answer alone: whether the honest
fix is to narrow the copy, or to **make the crew half recordable offline** and keep the copy. The
second is the better product and a much larger change (offline crew events, reconciliation, the
fail-closed rules in `rollCallCompleteness`), and it is a roadmap call.

## Proposed change

Narrow the copy now; treat offline crew recording as a separate roadmap item.

1. Rewrite the four strings so the assertion is scoped to divers and the crew half is stated rather
   than omitted. The shape that is true today: *divers get counted with the radio off; the crew
   half needs service, so the checkpoint stays open until they're accounted for.* Keep the captain's
   register (`principles.md` §4) — this is a sentence about what the screen does, not about
   encryption or reconciliation.
2. `marketing.pricing.faq.offline.answer` stops opening with a bare "Yes." — the honest answer is
   "Partly, and here's which part."
3. Reword `docs/product/marketing.md:102` so the claims policy bounds the claim instead of
   presupposing it.
4. Update both locales in the same change (`pnpm check:locale`), get a `dive-domain-expert` review,
   and triage the marketing visual diffs.

I am specifically **not** proposing removing the offline claim, softening it to "coming soon", or
touching the V-02 verification decision — the diver half genuinely works with no signal and is
worth saying.

Separately worth its own entry if not taken here: the
[V-02 run sheet](../pilot-kit/v-02-field-test-run-sheet.md) step 9 still tests a **typed crew
count** that ADR 20260804-crew-roll-call-is-per-person retired, so the field test as printed hunts
a field that no longer exists and leaves the two states that genuinely hold a checkpoint open
untested.

## Prompt

```text
Read src/components/OfflineManifestView.tsx (the crew-half comments around the
`rollCallCompleteness` call and the crew section render), then these four strings in
src/i18n/locales/en-US/diver.json: marketing.pricing.faq.offline.answer,
marketing.features.diveDay.item5, marketing.about.heroDescription, and
switching.spreadsheet.wedge.manifestHeadCount.body.

All four say roll call works offline. The code says divers can be counted with the radio off but
crew cannot in this slice, and a checkpoint needs both halves, so an after-dive count offshore
stays open on a device copy. The copy is wrong about a safety surface.

Narrow each string so the claim is scoped to the diver half and the crew half is stated plainly
(the checkpoint stays open until crew are accounted for). The pricing FAQ must stop answering
"Does the manifest work offline?" with a bare "Yes." Keep the captain's register from
docs/design/principles.md section 4 — describe what the screen does, not encryption or
reconciliation machinery. Do NOT remove the offline claim or mark it coming-soon: the diver half
genuinely works and is worth saying. Do not change the V-02 field-verification decision; the
product owner is settling that separately.

Update es-ES in the same change. Reword docs/product/marketing.md line 102, which currently
presupposes the unbounded claim in the claims policy itself.

Done when: pnpm check:locale and pnpm check green, a dive-domain-expert review has signed off on
the new wording, and the marketing visual diffs are triaged and explained in the PR. Delete
docs/product/follow-ups/FU-20260812-offline-roll-call-copy-overstates-the-crew-half.md as part of
the change.
```
