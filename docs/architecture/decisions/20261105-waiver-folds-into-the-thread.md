# 20261105-waiver-folds-into-the-thread — Hand a seat's release over as its thread link

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decided by:** Aaron, 2026-11-05 on issue #2743 ("do it"), the full idea that
  [20261103-waiver-signs-in-the-thread](20261103-waiver-signs-in-the-thread.md) rejected.

## Context

20261103 let a diver sign their own seat on their readiness link but kept a waiver link for
everything else. Issue #2743 asks for one credential per seat, and `waiver_records` losing
`token_hash` and `expires_at`. Waivers are safety-critical, so the work goes in reviewed layers.

## Decision

**A seat's release is handed over as the holder's thread link**, `readinessWaiverLinkPath` on the
seat's delivered readiness capability, only ever to the holder's contact on file. A waiver link
remains only for a release with no seat; a counter tablet gets its own capability.

**Layer 1 (built): the booking confirmation** carries the Sign step on its own readiness link
(`openJoinSignStep`, `openWaiverInThread`).

**Layer 2 (built): every other send of a seat's release** goes through `deliverThreadLink`. **No
"Copy link" for a seat** (`thread_only`): a copied thread link would put the holder's whole
readiness credential in a staff clipboard. A party member gets their own thread link.

**Layer 3 (built): a party lead signs a minor's seat on their own link**,
`/ready/<token>/party/<seat>/waiver`, keyed by `partySeatWaiverKey` (the panel's door, re-read on
every act); `party-return.ts` and its cookie are deleted.

**Layer 4 (built): counter tablets sign on a `waiver_link` capability**, a 30-minute once-use row
naming the release (`waiver_record_id`), spent in the signing transaction. The envelope is deleted.

**Layer 5 (built): `/waivers/<token>` refuses a seat's release** (`waiverLinkDoor`): no form,
draft, receipt or doctor's page; its rescue mails the thread link. `/waivers/[token]/doctor` is
deleted; the doctor's page is the thread's.

**Next:** bookingless releases move to `waiver_link`, and `waiver_records` drops `token_hash` and
`expires_at`.

## Alternatives considered

- **Drop the columns first.** Rejected: senders would mint a capability the next layer deletes.
- **Keep 20261103's split.** Rejected by Aaron.
- **Copy a waiver-only link, or an undelivered readiness row.** Rejected (security review): two
  credentials per seat, or the booker's own browser link.

## Consequences

- The Sign step lasts as long as the readiness link and states no expiry. A record opened for the
  thread carries that link's expiry (`capabilityExpiryFor`). Keeping a waiver link a staffer already
  sent lengthens it to the same bound until the columns go.
- **Authority.** The Sign step runs on the whole readiness capability, which also pays, cancels,
  moves and adds seats until the trip ends plus its grace. Forwarding the mail forwards all of
  that. Accepted for the holder's own seat (security review, S1).
- A seat with no email or textable number, or on a rehearsal, is signed at the counter or on paper.
- A counter link dies on a merge, a holder change or a new QR; staff show a fresh one.
- `openWaiverInThread` requires the holder and departure the caller read (S3); a confirmation
  records the release as emailed only when it `carriedSignStep` (A2).
