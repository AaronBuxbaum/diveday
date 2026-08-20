# FU-20260820-waiver-link-reissue-invalidates-the-last-one — Decide what a second waiver-delivery tap should do when a live link already exists

- **Status:** Open
- **Raised:** 2026-08-20 — branch `claude/diver-waiver-ctas-54fg5e`, the diver record's four-way
  waiver action row
- **Kind:** risk
- **Effort:** M
- **Touches:** `src/db/waivers.ts`, `src/db/waiver-issue.ts`,
  `src/app/shop/[shopSlug]/divers/[personId]/_components/WaiverDeliveryActions.tsx`

## What I noticed

Every waiver delivery tap issues a **new** link, and `issueWaiverRequest` supersedes the diver's
previous pending record as it does (`src/db/waivers.ts`, the `supersededAt` update). So on the
diver's record, a staffer who taps **Copy link**, pastes the URL into their own WhatsApp, and then
taps **Text waiver** has just killed the URL they pasted — the diver taps it and gets the dead-link
page. The reverse order is the worse one: a diver part-way through filling the release online loses
their saved draft the moment anybody on the desk taps any of the three buttons.

This is not new behaviour — the single "Send / resend waiver and get link" button did the same
thing. What is new is that the row now offers *three* delivery buttons an arm's length apart, and
tapping two of them in one conversation is the obvious thing to do ("I'll text it and read it out
to you"). The old single button made that mistake take two deliberate rounds.

## Why it isn't already done

Out of the scope I was given, and the obvious fix is not available: tokens are stored **hashed**
(`waiverRecords.tokenHash`), so a live pending link cannot be re-read and re-shown — there is
nothing to hand back except a fresh one. Anything better than "reissue every time" needs a real
decision about the record model, which deserves its own review rather than being smuggled into a UI
change.

## Proposed change

Pick one, in rough order of my preference:

1. **Reuse a live link within its window.** Keep the plaintext token in the session/action result
   for the life of one page render, so a second tap in the same visit hands back the *same* URL.
   Cheap, fixes the common case (copy then text), and changes no storage. Does not help across two
   page loads.
2. **Ask before superseding.** `hasLivePersonWaiverRequest` already answers "a signable link is
   out there" (`src/db/waivers.ts`). The delivery buttons could route through the roster's existing
   `InlineConfirm` guard when it is true — "Ana already has a live link; send a new one?" — which is
   the same treatment a resend gets on the trip roster today.
3. **Stop superseding on reissue** and let several pending records stand per person, with
   `completeWaiver` retiring the rest. The honest model, and the largest change: it touches the
   integrity/audit story and the draft-resume path, so it needs its own ADR.

I am **not** proposing storing the token in plaintext. The URL is the capability
(`docs/engineering/capability-telemetry-runbook.md`) and hashing it at rest is the point.

## Prompt

```text
On the DiveDay diver record (/shop/<slug>/divers/<id>), the Waiver card offers Email waiver, Text
waiver and Copy link. Each one issues a fresh waiver link, and issuing supersedes the diver's
previous pending one — so tapping two of them in one conversation invalidates the first URL, and
either of them wipes a draft the diver is part-way through online.

Read first: src/db/waivers.ts (issueWaiverRequest, hasLivePersonWaiverRequest, saveWaiverDraft),
src/db/waiver-issue.ts (issueAndDeliverPersonWaiver), and
src/app/shop/[shopSlug]/divers/[personId]/_components/WaiverDeliveryActions.tsx.

The constraint that makes this non-obvious: waiver tokens are stored hashed, so an existing live
link cannot be read back and re-shown. Do not store tokens in plaintext.

Decide and implement one of: (1) reuse the token already returned to this page for a second tap in
the same visit; (2) guard a send behind an InlineConfirm when hasLivePersonWaiverRequest is true,
the way the trip roster already guards a resend; (3) allow several pending records per person and
retire the rest on completion — this one needs an ADR first.

Done means: a second delivery tap can no longer silently kill a link a staffer has already handed
over, there is a regression test for the case in src/db/waiver-issue.test.ts, and
e2e/waivers.spec.ts still passes. Run pnpm check, pnpm test src/db/waiver-issue.test.ts
--reporter=dot, and pnpm e2e e2e/waivers.spec.ts --reporter=line. Delete
docs/product/follow-ups/FU-20260820-waiver-link-reissue-invalidates-the-last-one.md as part of the
change.
```
