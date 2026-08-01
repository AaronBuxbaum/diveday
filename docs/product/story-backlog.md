# Story backlog

Open, partial, and review-blocked work carried forward from
[archive/ux-personas-20260730-findings.md](archive/ux-personas-20260730-findings.md) (the 2026-07-30
UX persona review). Each entry cross-references the persona or lens it serves in
[personas.md](personas.md) and links back to its original task number for full context (file
references, review notes, rationale) in the archive.

**Rules for this doc.** Entries are tickets, not essays — state what's left, not what already
shipped. When a ticket is picked up, either close it out here (delete the entry) or, if it only
partially resolves, update the "left to do" line rather than leaving stale text. New open items
found while evaluating work against `personas.md` belong here too, not back in the archive.

---

## Leo (persona 15) — self-serve email unsubscribe

**Origin:** archive task 122. **Status:** implementation shipped (2026-08-01) — the general,
person-level mechanism now covers the two remaining courtesy kinds named in task 122
(`waitlist_invite`, `trip_recap`), on top of `last_minute_deal`'s existing per-entry unsubscribe.

**Left to do:** mandated `security-reviewer` pass outstanding before merge — this touches a new
bearer-token flow and a new `people` column carrying diver preference state, per AGENTS.md.

---

## Priya (persona 3) — enforce course minimum age for public bookings

**Origin:** archive task 23. **Status:** partial — the safe subset shipped (a self-declared
attestation checkbox on the booking form, `minimumAge` rendered on course trip pages); the actual
gate is still open.

**Left to do:** `course_min_age` is still not enforced for public actors in `src/db/bookings.ts`.
Making it a hard gate means persisting a submitted birth date, which reopens the H-22 probing
vector the attestation checkbox was chosen specifically to avoid — this needs its own
`docs/product/human-decisions.md` entry (a policy call, not just an engineering change) before any
implementation, and the persisted-birthdate path needs a `security-reviewer` pass alongside
`dive-domain-expert` given its interaction with `findOrCreatePerson`'s email-match reuse (H-13).

---

## Lens 17 (redundancy/coupling) — unify the two waiver-send controls

**Origin:** archive task 140. **Status:** implementation shipped (2026-08-01) — decided to unify
rather than keep the bulk sender a distinct affordance: `bulkSendWaiversAction` and
`issueWaiversForBookings` are deleted, and the roster's bulk "tick divers, then send" now drives
the same `sendWaiversAction`/`WaiverSendControl` every other surface uses, via a small
`BulkWaiverSelectionProvider` (client-side selection state — a plain HTML cross-form `form="…"`
checkbox association was tried first but ticking one diver was observed to silently uncheck
another; see that file's doc comment).

**Left to do:** mandated `security-reviewer` pass outstanding before merge — this changes how
waiver-send requests reach `issueAndDeliverWaiver`, a security-sensitive path per AGENTS.md.

## Lens 17 (redundancy/coupling) — split the schedule route

**Origin:** archive task 153. **Status:** implementation shipped (2026-08-01) — `/schedule` is
now the public, canonical, embeddable page only (booking list, calendar, reviews, last-minute
signup); the dead `staffView` ternary and the staff KPI/builder surface are gone from it. Staff
trip scheduling moved to its own gated `/schedule/board` (`src/app/shop/[shopSlug]/schedule/board/`),
scoped by `session.user.shopId` like every other staff surface, never the URL `shopSlug`.
`isPublicShopRoute`/`isEmbeddableShopRoute` in `src/lib/auth.config.ts` gained a reserved-segment
carve-out (`RESERVED_SCHEDULE_SEGMENTS`, mirroring the existing course-page pattern) so `/board`
stays staff-only even though it sits under the otherwise-public `/schedule` prefix. The anonymous
`joinLastMinuteListAction` stayed on the public route's own `actions.ts`, separate from the staff
board's mutations.

**Left to do:** mandated `security-reviewer` pass outstanding before merge — this changes
`src/lib/auth.config.ts`'s public-route allowlist, a security-sensitive file per AGENTS.md.

## Lens 17 (redundancy/coupling) — security-reviewer pass on the waivers Template/Signatures split

**Origin:** archive task 155. **Status:** implementation shipped, mandated review outstanding.

**Left to do:** `/waivers` now has Template and Signatures tabs, closing the loop between the
template editor, signature chasing, and the signed-record evidence — but this touches waiver
records (security-sensitive per AGENTS.md) and the `security-reviewer` pass hasn't happened yet.
