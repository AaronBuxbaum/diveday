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
remains only where no thread exists or the signer is not the holder: a release with no seat, a
counter tablet, a party lead signing a minor's seat, and a bookingless release's doctor.

**Layer 1 (built): the booking confirmation** (online booking, staff seating, staff resend) carries
the Sign step on its own readiness link; `openJoinSignStep` opens the record with
`openWaiverInThread`. When the mail cannot go, the release goes on its own.

**Layer 2 (built): every other send of a seat's release** (staff "Send waiver" by email or text, a
held send, the join send for each party seat, identity confirm and split, the dead-link rescue)
goes through `deliverThreadLink`. **No "Copy link" for a seat** (`thread_only`), and a send that did
not land returns no link, only the reason and "Send by text": a copied thread link would put the
holder's whole readiness credential in a staff clipboard. A party member's seat goes to that
member as their own thread link, never the lead's.

**Next, in order:** a party lead signs a minor's seat on a lead-authorised page of their own
thread; counter tablets get a home; `/waivers/<token>` refuses a seat's release; the remaining
waiver link becomes a `capabilities` purpose and `waiver_records` drops `token_hash` and
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
- `openWaiverInThread` requires the holder and departure the caller read (S3); a confirmation
  records the release as emailed only when it `carriedSignStep` (A2).
