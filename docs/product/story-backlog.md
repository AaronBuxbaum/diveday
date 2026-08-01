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

## Ingrid (persona 5) — localize money end-to-end

**Origin:** archive task 35. **Status:** deferred, not started.

**Left to do:** add `currency` to `shops` (schema-change skill), thread it through
`formatMoneyCents` (`src/lib/format.ts` defaults `"usd"`), checkout creation
(`src/db/checkouts.ts`), tip presets, and course fee display. Stripe owns conversion arithmetic.
Prerequisite for any non-US shop. Needs its own ADR and careful payments-path test coverage — large
enough to warrant a dedicated change, not a follow-on to a copy pass.

## Ingrid (persona 5) — move Stripe line descriptions out of the domain layer

**Origin:** archive task 36. **Status:** deferred, blocked on the item above.

**Left to do:** `` `Deposit — ${title}` `` (`src/db/checkouts.ts`) and
`` `${course.title} — instruction` `` (`src/lib/courses.ts`) are English sentences composed in
`src/db`/`src/lib`. Return structured parts and compose the localized label at the call boundary —
natural to do together with the currency work above, since both touch the same Stripe line-item
composition point.

## Ingrid (persona 5) — per-recipient notification language

**Origin:** archive task 128. **Status:** deliberately deferred by standing architecture decision,
not a live gap.

**Left to do:** nothing right now. `src/lib/notifications/index.ts` picks the shop's locale for
every email; a diver whose own negotiated locale differs gets the shop's language instead. ADR
20260731-notification-locale scopes this to future work on purpose — revisit only alongside a
fresh review of that ADR, not as a standalone fix.

---

## Nadia (persona 1) — security-reviewer pass on the public course catalog

**Origin:** archive tasks 2–3. **Status:** implementation shipped (public course index +
certification-path pages), mandated review pass not yet done.

**Left to do:** run the `security-reviewer` pass the original tasks called for before merge. The
archived doc's inline review note is the checklist: shop must resolve via `getShopBySlug` (never
session) and 404 on a missing shop; public branch must fetch `listActiveCourses`, never the staff
`listCourses`; `courses/paths/page.tsx` and `paths/[pathSlug]/page.tsx` need the same `isActive`
discipline; edit/visibility controls gated by not rendering (not disabling); the new allowlist
entries must stay `$`-anchored, never copy `PUBLIC_SCHEDULE`'s open-ended tail; verify
unauthenticated access to the new routes and to the still-gated editor routes; cross-tenant check;
extend `src/lib/auth.config.test.ts`.

---

## Sal (persona 10) — follow-up dive-domain-expert review on the offline manifest port

**Origin:** archive task 72. **Status:** implementation shipped, including a fail-closed-logic fix
found during the port; the mandated follow-up review is outstanding.

**Left to do:** `canRecordOfflineStatus` was found gating readiness at every checkpoint instead of
only "departure" and was fixed (with a regression test in `offline-manifests.test.ts`) — but
AGENTS.md's safety-critical rule calls for a `dive-domain-expert` review pass specifically because
this touched fail-closed boarding logic. Get that review before treating the surface as settled.

---

## Victor (persona 13) — conversion-reviewer passes on two shipped surfaces

**Origin:** archive tasks 101 and 103. **Status:** implementation shipped, review outstanding.

**Left to do:** run `conversion-reviewer` against the "Cutover without drama" sections added to
the switching guides (task 101) and the demo role-picker on the landing page (task 103). Both are
conversion-sensitive surfaces the original tasks flagged for that pass.

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
