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

**A seat's release is handed over as the holder's thread link.** A waiver link remains only where
no thread exists or the signer is not the holder: a release with no seat, a counter tablet, a party
lead signing a minor's seat, and a bookingless release's doctor.

**Layer 1 (built): the booking confirmation.** The online booking, a staff seating and a staff
resend carry "Sign your waiver" as `readinessWaiverLinkPath` on the readiness link the same mail
carries. `openJoinSignStep` opens the seat's record with `openWaiverInThread`, so nothing mints a
waiver link and a link a staffer already sent keeps working. A bounce on the mail still reaches the
waiver. When the mail cannot go, the release goes on its own as a waiver link. Another seat in a party gets its own waiver link: a readiness link is
its holder's, never the lead's to forward.

**Next layers, in order:**

1. Staff "Send waiver" for a seat (email, text) hands over the thread link; then
   `/waivers/<token>` refuses a seat's release. **No "Copy link" for a seat's release**, and the
   failed-send fallback shows no link either, only "Send by text": a copied thread link puts the
   holder's whole readiness credential in a staff clipboard. 
2. A party lead signs a minor's seat on a lead-authorised page of their own thread.
3. The remaining waiver link becomes a `capabilities` purpose (expiring, superseding), and
   `waiver_records` drops `token_hash` and `expires_at`.

## Alternatives considered

- **Drop the columns first.** Rejected: senders would mint a capability the next layer deletes.
- **Keep 20261103's split.** Rejected by Aaron.

## Consequences

- The confirmation's Sign step lasts as long as the readiness link and states no expiry. A record
  opened for the thread carries that link's expiry (`capabilityExpiryFor`), so on day 8 it still
  reads awaiting a signature. Keeping a waiver link a staffer already sent lengthens it to the same
  bound until layer 3.
- **Authority.** The Sign step runs on the whole readiness capability, which also pays, cancels,
  moves and adds seats until the trip ends plus its grace; the waiver token it replaces unlocked one record. Forwarding the mail forwards all of that. Accepted for the holder's own seat; it
  keeps a seat's readiness link out of every inbox but the holder's (security review, S1).
- `openWaiverInThread` requires the holder and departure the caller read (S3). A confirmation
  reports `carriedSignStep`, and only then is the release recorded as emailed; otherwise it goes
  out on its own (A2).
