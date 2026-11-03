# 20261103-waiver-signs-in-the-thread — The diver's own release signs on their readiness link

- **Status:** Accepted
- **Date:** 2026-11-03
- **Decided by:** Aaron, 2026-11-02 ("Build all four" on decision group 7, issue #2743). The
  booking-scoped scope is the building thread's reading; Aaron named no shape.

## Context

The thread's Sign step (ADR 20260827-the-divers-thread) did not sign anything:
`signWaiverFromReady` minted a waiver token, set a cookie carrying the readiness token, and
redirected to `/waivers/<token>`. A diver held two credentials for one trip. The 2026-11-02
evaluations (`/mnt/project-files/decisions/premise-check/`, B and E) found that a full fold has no
home for releases with no seat, a parent signing a child's seat, or a counter tablet.

## Decision

**A diver signing their own seat signs on their readiness link, at `/ready/<token>/waiver`.** The
Sign step keeps the seat's live release, or starts a fresh one, and opens it there. Both doors call
one render function (`waiverSigningForm`) and one signing module (`waivers/[token]/signing.ts`).
A referred signer lands on the receipt in the thread; the doctor's page has a twin at
`/ready/<token>/waiver/doctor`.

- **The readiness capability is the authority.** Each act verifies it (`contextFor`: per-IP bucket,
  live capability, live seat; then the held-seat refusal) and resolves the record from the verified
  booking (`threadWaiverKey`): the newest release not superseded, on that seat, naming its current
  holder. The key pins the record id, so the re-read inside the signing lock is the same row. Only
  the readiness token is bound into the page, and no key-taking function is a server action.
- **The thread never needs the token.** `openWaiverInThread` keeps a live release on current terms
  even without a sealing key, so it never supersedes a link staff sent or the draft typed into it.
- **The waiver link stays** for releases with no seat, counter tablets, party leads and links staff
  send. It no longer reads a return cookie.
- **No schema change.** `token_hash`, `token_sealed` and `expires_at` serve the waiver link.

## Alternatives considered

- **Fold the whole waiver into the thread and drop the token columns** (the issue as filed).
  Rejected for now: bookingless releases, party leads and counter tablets need a credential that is
  not one diver's thread.
- **Render the release inline in the spine page.** Rejected: the paced release (rail, eleven
  questions) would make the five-step page long; a sub-page of the same link keeps the pacing, as
  course forms do (`/ready/<token>/forms`).
- **Keep the hop and hide it.** Rejected: it keeps the second credential and the cookie.

## Consequences

- One credential per trip for a diver signing their own seat, and no mint on the way to the form.
- The evidence, the release's words, the typed-name standard and every writer are unchanged.
- Still open on #2743: staff sends and booking emails could hand over the thread link instead of a
  waiver link. That changes staff copy and delivery records, so it is a separate decision.
