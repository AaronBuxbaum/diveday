# 20260820-waiver-links-are-reused-not-reissued — A live waiver link is handed back, not replaced

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

`issueWaiverRequest` (`src/db/waivers.ts`) minted a fresh 256-bit token on every call and marked
every non-superseded record for that booking or person `superseded_at = now`. One live link at a
time, and the newest wins — which reads as obviously correct until you watch what a shop does with
it.

The diver record now offers three ways to hand a release over side by side: **Email waiver**, **Text
waiver**, **Copy link** (#573). A staffer with a diver at the counter uses two of them in one
sentence — "I'll text it to you, and here's the link if it doesn't arrive" — and the second tap
killed the URL the first one produced. The failure is silent and lands on the diver: they tap the
link they were given and get the dead-link page.

The worse case predates that row. A diver part-way through signing online has their draft saved
against the pending record (`saveWaiverDraft`). *Any* staff send — from the roster, the check-in
queue, Today, or the diver record — superseded that record and took the half-filled questionnaire
with it. Nothing in the product told anyone this had happened.

What made it hard to fix is that the token is stored as a SHA-256 digest and nothing else
(`src/lib/bearer-tokens.ts`): "a database reader — a backup, a support query, a leaked dump — must
not come away holding usable credentials." A digest cannot be read back, so there was no way to
re-send the link a diver already had. Reissuing was not a policy anyone chose; it was the only
thing the storage could do.

## Decision

**A live waiver link is reused.** `issueWaiverRequest` hands back the token the diver already holds
and refreshes its expiry, superseding nothing and inserting nothing.

To make that possible, `waiver_records` gains `token_sealed`: the same token sealed with
AES-256-GCM under `SECRET_ENCRYPTION_KEY` (`src/lib/secret-box.ts`, already how a shop's WhatsApp
credential is stored). `token_hash` is unchanged and is still what every lookup matches.

"Live" is four conditions, and each is load-bearing:

- **Pending and not superseded** — a completed record has nothing to hand out.
- **Not expired** — the seven-day TTL stays a real bound. A link that already died is not
  resurrected; reviving a months-old URL is precisely what a leak would want. A fresh one is minted.
- **Snapshotted from the template that is current now** — a shop that edited its release has
  withdrawn the old terms, and handing the old link back would collect a signature against them.
- **Openable** — with no sealing key there is no readable copy, and issuing falls back to exactly
  the mint-and-supersede it did before.

The sealed copy exists only while the link does. It is written on insert and nulled when the record
is superseded, completed, or the diver's personal data erased (`anonymizeDiver` already rotates
`token_hash` and pulls `expires_at` back; it now clears this too).

One case keeps its ciphertext: a link nobody ever reissued over, left to expire. Nothing opens it
again — reuse refuses an expired record, and the next issue supersedes and clears it — and what it
seals is a token that resolves to `expired`, so it is not a live credential. Clearing it on the
stroke of expiry would want a sweeper, and that is more moving parts than the exposure justifies.

## Alternatives considered

- **Keep minting, but stop superseding.** No storage change: several pending records per subject,
  all valid, retired together on completion. It saves the diver's draft and keeps old links alive,
  but it does not answer the request — a shop that taps Copy link twice still gets two different
  URLs — and it turns "the diver's link" into a set, which every reader (`getDiverWaiverRequestStatus`,
  the signature audit, readiness) would then have to have an opinion about.
- **Keep the token only for the life of one page render**, threaded through the action result. Fixes
  copy-then-text in a single visit and nothing else; a reload, a second staffer, or a send from
  another surface is back to a dead link. It is a UI patch for a storage problem.
- **Derive the token from the record id** — `recordId || HMAC(key, recordId)` — so nothing extra is
  stored at all. Genuinely attractive: the digest column stays the only stored material, and the URL
  is recomputable forever. Rejected on ordering, not on merit: the token must exist before the row
  it is derived from does, so issuing becomes insert-with-placeholder-then-update, and `token_hash`
  is `not null unique`. Worth revisiting if a second surface ever needs the same trick.
- **Store the token in plaintext.** Rejected. The sealed column costs one `openSecret` call and
  keeps a database dump worthless on its own.

## Consequences

- **The security posture changes in exactly one scenario, and it is named here.** Before: a dump of
  the database yielded no usable waiver link under any circumstances. Now: a dump *plus* the
  deployment's `SECRET_ENCRYPTION_KEY` yields the links that were live at dump time. The key is not
  in the database — it is derived from the stack seed and lives in the environment — so this is the
  "attacker holds both the data and the application secrets" case, in which they also hold the
  session secret, the Stripe key, and `people` itself, which carries far more than a link to a blank
  release does. The bound that keeps this small is that the copy is nulled the moment the link is
  spent, so what leaks is at most the currently outstanding links (plus any left to expire
  untouched, which no longer open anything), never the history.
- **A diver's draft survives a staff send.** The behaviour nothing warned about is simply gone.
- **`emailFreshWaiverLink`'s guard is now belt-and-braces.** It still refuses when a live link
  exists (`current_link_live`), but the reason its comment gave — that issuing would kill the live
  link and take the draft — no longer applies. The refusal stays because a stale-link bearer should
  not be able to drive delivery on a live one, which is a different argument.
- **Two of the four ways a link dies are now the only ways it dies.** Expiry and an edited template
  supersede; asking twice does not. `pnpm check:env` names the reuse in what a missing
  `SECRET_ENCRYPTION_KEY` costs, and the e2e fleet sets the key, so the reuse path is what CI
  exercises rather than the fallback.
- **The fallback is real and tested.** A deployment with no sealing key behaves exactly as this code
  did before — a regression test pins that, so the degraded path cannot rot unnoticed.
