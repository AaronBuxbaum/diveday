# 20261105-waiver-folds-into-the-thread — Hand a seat's release over as its thread link

- **Status:** Accepted, **amended 2026-11-06** (issue #3983, layer 6)
- **Date:** 2026-11-05
- **Decided by:** Aaron, 2026-11-05 on issue #2743 ("do it"), the full idea that
  [20261103-waiver-signs-in-the-thread](20261103-waiver-signs-in-the-thread.md) rejected; layer 6
  by Aaron on issue #3983, 2026-11-06.

## Context

20261103 let a diver sign their own seat on their readiness link but kept a waiver link for
everything else. Issue #2743 asks for one credential per seat, and `waiver_records` losing
`token_hash` and `expires_at`. Waivers are safety-critical, so the work goes in reviewed layers.

## Decision

**A seat's release is handed over as the holder's thread link** (`readinessWaiverLinkPath`), only
ever to the holder's contact on file. Every other release link is a capability.

1. **The booking confirmation** carries the Sign step on its readiness link (`openJoinSignStep`).
2. **Every other send of a seat's release** goes through `deliverThreadLink`. No Copy link for a
   seat (`thread_only`): it would put the whole readiness credential in a staff clipboard. A party
   member gets a `party_waiver_link` door (#3986).
3. **A party lead signs a minor's seat on their own link** (`partySeatWaiverKey`).
4. **Counter tablets sign on a `waiver_link`**: 30 minutes, once, on the first phone to claim it.
5. **`/waivers/<token>` refuses a seat's release** (`waiverLinkDoor`); the doctor's page is the
   thread's.
6. **A release with no seat signs on a capability too.** Signed, it covers every seat the diver
   holds. Copy link mints a counter link, with the staffer on the diver's trail; email and text
   mint a `release_link` (a week, the contact on file only, never returned to staff). Signing
   spends it, a contact change revokes it, an erasure deletes it; a dead one lands on a rescue
   that mails the address on file. The record carries no link and no clock. `token_hash` and
   `expires_at` are undeclared for one release, dropped in the next.

**A release holds one live door**: minting a `waiver_link`, `party_waiver_link` or `release_link`
revokes the others (#4008).

## Alternatives considered

- **Drop the columns first.** Rejected: senders would mint a capability the next layer deletes.
- **Keep 20261103's split.** Rejected by Aaron.
- **Copy a waiver-only link, or an undelivered readiness row.** Rejected (security review): two
  credentials per seat, or the booker's own browser link.

## Consequences

- The Sign step lasts as long as the readiness link; the record has no clock of its own.
- **Authority.** The Sign step runs on the whole readiness capability, which also pays, cancels,
  moves and adds seats until the trip ends plus its grace. Accepted for the holder's own seat
  (security review, S1).
- A seat with no email or textable number is signed at the counter or on paper.
- A counter link dies on a merge, a holder change, a contact change or a new link; staff show a
  fresh one. A failed email or text hands staff nothing: the way to a URL is Copy link.
- A link only prefills the medical answers saved through itself.
