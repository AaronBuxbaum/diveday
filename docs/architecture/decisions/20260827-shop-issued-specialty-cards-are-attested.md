# 20260827-shop-issued-specialty-cards-are-attested — A shop's own specialty or nitrox class records a card, and the card still waits for a sighting

- **Status:** Accepted
- **Date:** 2026-08-27
- **Relates to:** [20260824-shop-issued-certification-is-verified](20260824-shop-issued-certification-is-verified.md) (the level ladder's opposite answer), [20260725-import-specialty-cards](20260725-import-specialty-cards.md) (the precedent this follows)

## Context

Issue #717 gave a course session's roster a per-student "Certified" tap that writes a
`certifications` (level) row landing `verified` immediately with no card number: the shop's own
instructor is the evidence, not a sighted physical card. That was deliberately scoped to the level
ladder.

A `dive-domain-expert` review of it flagged that a shop's own Deep, Wreck, Night, Drysuit or Nitrox
class is exactly as real an operational gap. A diver finishing a Nitrox class on Saturday afternoon
wants a fill on Sunday morning and has no path — their own shop, which certified them, cannot see it.

But the precedent in this codebase argues for **more** caution there, not the same treatment:

- `specialty_certifications.identifier` was `text().notNull()` with no nullable path at all, and the
  schema comment was explicit: "a specialty is a yes/no gate on a materially riskier dive, so there
  is no version of one that is only a claim with no number behind it."
- Even an **imported** specialty or nitrox row — which this codebase trusts enough to clear *level*
  gates on arrival — is deliberately held back from clearing its own gate until a staffer confirms
  it by hand. "A spreadsheet cell is not a card sighting"
  ([20260725-import-specialty-cards](20260725-import-specialty-cards.md)), and a wrong nitrox fill
  is the highest-consequence failure in the app.

So extending #717's shape was not an obvious generalization. It is a distinct product question about
what an instructor's own word is worth on a materially riskier dive, and the product owner was asked
directly.

## Decision

**The record is written; the gate is not opened.** A shop-issued specialty or nitrox card lands
`pending`, carries its provenance, and clears nothing until a staffer confirms it against the
physical card.

Concretely:

- `specialty_certifications` and `nitrox_certifications` each gain `issued_by_shop_at`,
  `issued_from_trip_id` and `issued_by_person_id`, mirroring the level table's three.
- `specialty_certifications.identifier` becomes nullable — but **only** for this one case, enforced
  by `specialty_certifications_identifier_present_unless_unsighted`. Every other path (a staff
  capture, an import, a diver's declaration) still carries a number, and unlike the level table's
  twin constraint, the shop-issued arm is conditioned on `status = 'pending'`: a shop-issued
  specialty **cannot reach `verified` without a number**, in the database and not only in the action.
- `needsCardSighting` replaces `isUnsightedSelfDeclaration` at the two review paths. Both kinds of
  numberless pending card — a stranger's typing and this shop's own class — demand the agency and
  the number off a card before the confirm goes through. They are very different in what they are
  worth and identical in what the confirm must ask.
- The roster's existing per-student control gains a specialty/nitrox group beside the level ladder,
  so it is one tap and one place, and its hint states the one thing that differs.

## Alternatives considered

**Full parity with #717 — one tap to `verified`.** Fastest for the diver, and coherent as a rule
("the instructor is the evidence, wherever they teach"). Rejected: it contradicts this table's own
schema comment and the imported-card ADR, both written deliberately and both about exactly this
gate. It would also make DiveDay's *least* verified nitrox path the one that authorizes a fill,
which inverts the caution the rest of the nitrox handling is built on.

**Leave it alone — manual capture-and-verify stays the only path.** Zero code, and it lets #717
prove the underlying pattern before extending it. Rejected because the gap is real and the fix here
costs nothing in safety: the record existing is what turns "a card nobody knows to look for" into "a
confirm one tap away on the diver's record", and no gate moves either way.

**A new `attested` status alongside `pending`/`verified`.** More expressive — it would distinguish
"this shop taught it" from "a stranger typed it" in the status itself. Rejected as premature: every
reader in the app branches on `verified` or not, the provenance columns already carry the
distinction for anything that wants to show it, and a third status is a change every existing
`status === "pending"` check would have to be re-audited against. The two are already distinguishable
by `issuedByShopAt`.

**Write the row only when the agency number arrives.** No schema change at all. Rejected: that is
the status quo, and the days between the class and the number are precisely the window the diver is
in the shop asking for a fill.

## Consequences

A shop's own graduate stops being invisible to their own shop between the class and the agency's
paperwork. What a staffer does about it is unchanged in kind — read the card, confirm the row — but
they now have something to confirm, on the diver's own record, instead of a card nobody knew to
chase.

**Nothing about a gate moved.** Readiness, trip admission, capacity, and enriched-air fill
authorization all read `verified` and only `verified`, and this ADR adds no `verified` row anywhere.
The change is monotonic in the safe direction: strictly more is recorded, strictly nothing more is
permitted.

The asymmetry between the two tables is now load-bearing and should stay written down: a level card
lands `verified` on the instructor's tap and a specialty or nitrox card does not, and a future reader
who notices the inconsistency and "fixes" it in the permissive direction would silently make an
instructor's tap authorize a gas fill. Both check constraints carry the reasoning at the SQL, and
`needsCardSighting`'s doc comment carries it at the predicate.

The nullable `identifier` is the one thing that got structurally weaker, and it is fenced: the
constraint's shop-issued arm demands `pending`, so the sentence the old NOT NULL was protecting —
"there is no version of a specialty card that is only a claim with no number behind it" — is still
true of every `verified` row, which is the only kind anything reads.
