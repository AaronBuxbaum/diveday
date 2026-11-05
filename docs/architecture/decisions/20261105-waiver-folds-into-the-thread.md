# 20261105-waiver-folds-into-the-thread — Hand a seat's release over as its thread link

- **Status:** Accepted
- **Date:** 2026-11-05
- **Decided by:** Aaron, 2026-11-05 on issue #2743 ("do it"), the full idea that
  [20261103-waiver-signs-in-the-thread](20261103-waiver-signs-in-the-thread.md) rejected.

## Context

20261103 let a diver sign their own seat on their readiness link, at `/ready/<token>/waiver`, but
kept a waiver link for everything else, booking emails included. Issue #2743 asks for one
credential per seat: the link a staffer or a mail hands over is the thread link, and
`waiver_records` loses `token_hash` and `expires_at`. Waivers are safety-critical, so the work goes
in layers, each with adversarial tests and its own reviews.

## Decision

**A seat's release is handed over as the holder's thread link.** A waiver link remains only where
no thread exists or the signer is not the holder: a release with no seat, a counter tablet, a party
lead signing a minor's seat, and a bookingless release's doctor.

**Layer 1 (built): the booking confirmation.** The online booking, a staff seating and a staff
resend carry "Sign your waiver" as `readinessWaiverLinkPath` on the readiness link the same mail
carries. `openJoinSignStep` opens the seat's record with `openWaiverInThread`, so nothing mints a
waiver link and a link a staffer already sent keeps working. The record's delivery is recorded as
before, so a bounce on the mail still reaches the waiver. When the mail cannot go, the release goes
on its own as a waiver link. Another seat in a party gets its own waiver link: a readiness link is
its holder's, never the lead's to forward.

**Next layers, in order:**

1. Staff "Send waiver" for a seat (email, text, copy link) hands over the thread link; then
   `/waivers/<token>` refuses a seat's release.
2. A party lead signs a minor's seat on a lead-authorised page of their own thread.
3. The remaining waiver link becomes a `capabilities` purpose (expiring, superseding), and
   `waiver_records` drops `token_hash` and `expires_at`. Readiness then reads "link expired" from
   that invitation.

## Alternatives considered

- **Drop the columns first.** Rejected: every seat sender would mint a capability the next layer
  deletes.
- **Keep 20261103's split.** Rejected by Aaron.

## Consequences

- The confirmation's Sign step lasts as long as the readiness link, not a week, and states no expiry.
- Until layer 3 the opened record still carries a week's `expires_at`. Past it, staff read "link
  expired" and the mail's Sign step lands on `/ready`, whose Sign step opens a fresh release.
