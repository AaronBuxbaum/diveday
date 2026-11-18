# Boarding observation receipt: working design for #4474

Status: **unimplemented and not approved for activation**. This design preserves the
existing held-reset and late-intake regressions; it does not establish safety or
authorize capture, settlement, delivery, migration, merge, or deployment.

## Required behavior

A receipt means only that one authenticated observation has committed durably.
It does not mean the person boarded, a seat was assigned, or the observation was
settled. A device retains its queued event until it verifies that receipt. A
response lost after commit is retried with the same event ID and immutable intent.
The original shop, schedule generation, trip, booking, and actual meeting day must
not be inferred from the current booking after a move or reset.

The stronger existing regression requires the original booking row to survive a
held reset while intake commits before that reset finishes. Keeping only a detached
archive does not meet that requirement. No test is relaxed to equate an archive
with the original row.

## Candidate vertical slice

1. At authenticated snapshot issuance, bind a server-authenticated context to an
   immutable shop ID, generation ID, trip ID, booking ID, actual meeting-day ID
   and time context, permitted actor/scope, issuance and expiry, and key ID. A
   missing or ambiguous day is explicitly unknown; it is never guessed from
   today's schedule. The device also stores the client event ID and the event's
   immutable intent. The signed context is evidence of issuance, not a grant that
   overrides current revocation or erasure.
2. Make demo reset create a new active generation and atomically switch the shop's
   active-generation pointer, leaving the original generation's actual booking,
   trip, meeting-day and staff context intact. Readers of active schedule data
   must explicitly filter by the active generation; review readers must instead
   constrain historical reads to the authenticated tenant and authorized scope.
   Reset, snapshot replay, reap and eviction must share the same preservation
   policy. Existing rows are not automatically migrated while the contract is
   incomplete. This step has not been implemented and requires a schema, lifecycle
   and rollout design before it can be considered safe.
3. Intake verifies authenticated tenant and current authorization, the signed
   original context, expiry and revocation policy, then inserts an append-only
   receipt keyed by `(shop_id, client_event_id)`. It records protected structured
   event, subject and original-meeting facts sufficient for review, actor provenance,
   server receipt time, and a canonical intent digest; a digest alone is not a
   reviewable observation. The same key and digest returns the existing receipt
   only under the applicable authorization and retry policy; a changed digest is
   refused and never retargeted. A success response is emitted only after commit
   and is bound to the tenant, event ID, digest and committed receipt. Old clients
   must not discard an event on an incompatible acknowledgement.
   References or checks must not acquire locks on rows the reset is holding; the
   authorization and revocation mechanism that makes this possible is unresolved.
4. An authenticated shop-scoped review inbox reads original-generation context
   independently of active roster joins. It shows an unresolved observation against
   the original meeting even after a move, move-back or reset. It does not create a
   present/aboard state or change capacity. Review and reconciliation must verify
   identity, live authorization and erasure state before taking any later action.

## Evidence required before use

- Real PostgreSQL barriers: reset held before commit with prompt receipt and the
  original booking unchanged; the existing intake-held test's `55P03` refusal;
  the existing post-delete test's refusal and original reader visibility; response loss
  and retry; late upload after committed reset; reset/reap and snapshot paths.
- Original meeting and tenant isolation: multiple days, moves in both directions,
  move-back, deleted and recreated IDs, missing day, changed intent under the same
  ID, and no current roster row. Neither stale context nor a receipt implies aboard.
- Security: key rotation and unavailable keys; expired or revoked actor/context;
  erasure and exports across generations; retention of opaque or unsent evidence;
  no selective-erasure claim for an unreadable retained device copy.
- Deployment: all old reset/reap writers and offline shells can coexist or are
  safely drained, and the active-generation transition is atomic. Old writers
  that delete originals or bypass the receipt protocol invalidate this design.
- Independent domain and security reviews, real browser offline/retry tests and
  exact-head CI. The present exclusive shop-wide fence does not prove timely intake
  while a schedule transaction holds it and is not sufficient by itself.

## Open decisions

The data model for immutable generations and their lifecycle, auth/revocation
checks that avoid reset-held locks, receipt retention and erasure, and the staff
recovery experience remain unresolved. A design that lets reset finish where an
existing regression requires refusal needs an explicit contract decision; it does
not pass the unchanged test. Context must exist before a device snapshot can
outlive reset. Audit every reader, writer, cache, uniqueness and capacity rule,
export, background job and old server against the generation switch. Reap must
preserve an authorized tenant and actor authority or refuse deletion.

Define canonicalization and protected digest handling, acknowledgement and retry
behavior after revocation or expiry, and the order of acceptance versus revocation
and erasure. An asserted tap time is not authenticated merely by signing a snapshot.
An unknown day remains unknown in storage, review and settlement. A pointer switch
alone cannot fence an old or concurrent writer. Inventory must indicate withheld
evidence without exposing another tenant, and unavailable uploads remain on device.
Device-only taps cannot be recovered by a server receipt until sent. The current production
reader inner-joins live bookings and people; merely adding a receipt table would
therefore still hide late observations after destructive reset.

## Lock-order audit in progress

This is an inventory of known paths, not a complete writer or mixed-version
audit. A consistent order cannot be claimed until the remaining callers and
their enclosing transactions are checked.

| Path | Current order or behavior | Consequence |
| --- | --- | --- |
| Preview first-open and manual demo reset (`src/app/actions/demo.ts`) | This experiment takes the exclusive evidence fence before the shop identity gate; preview has already written its preview-open record. | The preview row's order needs audit; other writers retain incompatible orders. |
| Direct reset and clear (`src/db/seed.ts`) | Exclusive evidence fence via the photo-obligation guard, then destructive child and parent deletes. | A held reset can block current intake on staff/shop foreign keys; it deletes original bookings and trips. |
| Demo reap, eviction and cap (`src/db/seed-demo-lifecycle.ts`) | Cascade begins with the same exclusive fence; cap may act on multiple shops in a caller's transaction. | Multiple-shop order, revalidation and old transactions need proof. |
| E2E snapshot replay (`src/features/demo-reset-snapshot/store.ts`) | Replica mode, then clear and the exclusive fence; a replay failure falls back to reset. | Advisory locks still apply, but replica mode disables trigger/FK enforcement; fallback must not bypass preservation. |
| Current dock intake (`src/db/boarding-observations.ts`) | Reads live staff and booking, inserts a row with shop/person references; no receipt fence or immutable original generation/day. | A held reset can time out the insert; a joined tap's second event key is not durably reserved. |
| Invite/role/status/removal (`src/features/staff-accounts/store.ts`) | This experiment takes the exclusive evidence fence before the shop identity lock and person/account/role/session writes. | Other writers and old servers do not all participate; an unrelated holder can delay urgent staff changes. |
| Password and session revocation (`src/db/user-accounts.ts`, `src/db/account-security.ts`) | Account/session operations do not participate in the evidence fence. | A fresh role read alone does not establish session validity at commit. |
| Erasure and merge (`src/features/anonymize/store.ts`, `src/db/diver-merge.ts`) | Exclusive evidence fence precedes the person and booking locks. | Coordinated receipt must check live authority and erasure after acquiring its own fence; the rest of the writers still need audit. |
| Single and party moves (`src/db/bookings.ts`) | The single-move helper acquires trip and booking locks; party moves prelock trips before invoking that helper. | A fence added only inside the shared helper violates fence-first ordering for party moves. A shop-wide fence alone also starves intake behind a long move. |

In this experiment `lockDemoResetEvidenceFirst` is called by the named preview,
manual reset and refresh paths; it takes the evidence fence before the existing
demo identity gate in one READ COMMITTED transaction. It cannot tell whether
its caller already holds another lock, preserve a booking, or accept an observation.
The experiment does not coordinate every writer or change old servers. Its
PostgreSQL tests have not established a rollout or passed the held-reset
acceptance tests. An exclusive fence still makes a simultaneous receipt try
return unavailable, so device retention and a separate durable intake path are
prerequisites, not optional follow-up work.
