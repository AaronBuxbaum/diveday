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

## Leo (persona 15) — self-serve email unsubscribe

**Origin:** archive task 122. **Status:** partial — the email document wrapper, brand-token swap,
and shop-name header shipped; the unsubscribe link is the deferred half.

**Left to do:** there's no self-serve unsubscribe token/route today, only a staff-side
`unsubscribeLastMinuteListEntry`. Building a diver-facing one is a real feature (a new token type,
a route, a `security-reviewer` pass) — scope it as its own change, not a follow-on to the wrapper
work.

---

## Lens 17 (redundancy/coupling) — unify the two waiver-send controls

**Origin:** archive task 140. **Status:** partial — the roster now mounts the optimistic
`WaiverSendControl`, but the roster's checkbox-driven bulk sender (`bulkSendWaiversAction`) is a
separate, untouched path.

**Left to do:** decide whether the bulk sender should route through the same control/action or
stay a deliberately distinct bulk affordance, and document the decision either way.

## Lens 17 (redundancy/coupling) — split the schedule route

**Origin:** archive task 153. **Status:** deferred — explicitly called out as the single
highest-risk item in the original review.

**Left to do:** `/schedule` is still four products on one route (staff KPIs + builder, public
calendar + booking list, reviews, last-minute signup, plus embed mode), including a provably-dead
`staffView` ternary in the not-staff branch and the anonymous `joinLastMinuteListAction` living in
the auth-gated builder's action module. The plan (public/canonical/embeddable page at `/schedule`,
staff builder moves to `/schedule/board`) is written in the archive; it needs a dedicated change
touching e2e specs, sitemap, and canonical metadata — don't fold it into an unrelated PR.

## Lens 17 (redundancy/coupling) — security-reviewer pass on the waivers Template/Signatures split

**Origin:** archive task 155. **Status:** implementation shipped, mandated review outstanding.

**Left to do:** `/waivers` now has Template and Signatures tabs, closing the loop between the
template editor, signature chasing, and the signed-record evidence — but this touches waiver
records (security-sensitive per AGENTS.md) and the `security-reviewer` pass hasn't happened yet.
