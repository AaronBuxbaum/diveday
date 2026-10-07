# H-48: Who may sight a card?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Who may sight a card?** A *card sighting* — a staffer naming the agency, number and rung off the physical card in their hand — is the single act that turns a diver's own typing into `verified` state (ADR [20260814-self-declared-cards](../../architecture/decisions/20260814-self-declared-cards.md)). Everything downstream reads it: readiness, booking-time trip admission, every course prerequisite, the nitrox fill gate and the depth advisory. `reviewAction` (`src/app/shop/[shopSlug]/divers/[personId]/actions.ts`) gates on `requireStaffSession()` and no role predicate, so a captain or a deckhand can perform it. This is **not a regression** — capturing a card has always been open to every staff role, and the sighting form deliberately mirrors that act — but H-14's pattern has been to pull lasting shop-wide authority up to owner/manager (refunds, diver deletion, erasure), and a sighting is a stronger act than a capture: the diver's claim is already on the record, so what the tap adds is the shop *standing behind* it. Counter-argument to weigh: the person holding the card at the dock is usually crew, and a gate they cannot pass means the sighting happens later, from memory, or not at all — which is how a claim quietly stays a claim while a boat fills.

## Minimum outcome to record

Whether sighting a self-declared card is owner/manager-only, crew-wide as today, or somewhere between (e.g. instructor/divemaster, matching `canOverrideGearRequest`'s in-water-judgement reasoning) — and, whichever way it goes, whether this action should read **live** roles. A 2026-08-15 `security-reviewer` pass noted that `reviewAction` trusts the JWT, which H-15 accepted a 30-day staleness window for, so a staffer whose access was removed keeps the ability to convert a claim into `verified` until their token expires. The same file already re-reads live roles for refunds, removal, erasure and the gear-fit flag; this is a `loadActiveStaffRoles` call whether or not the role set narrows.

## Unblocks / follow-up

Under "yes, narrow it": add `canPersonSightCard` to `src/db/authz.ts` mirroring `canPersonRefund`, gate `reviewAction`'s **sighting** branch on it (never the one-tap review branch beside it, which stays open — that card already carries a number a staffer typed), and say so on the form. Under "no": the reasoning is recorded in the ADR so the next reviewer does not re-raise it. **Decided 2026-08-20: any staff.** Sighting stays open to every staff role, ungated. The person holding the card is crew, at the dock, and a gate they cannot pass does not make the sighting more careful — it makes it later, from memory, or never, which leaves a claim reading as a claim while a boat fills. The act is also weaker than H-14's gated set: it records what a staffer's eyes saw, it does not move money or destroy a record, and the one-tap review branch beside it was always open. The live-role half of this row is **already closed** — `requireDiverActionContext` (`src/app/shop/[shopSlug]/divers/[personId]/actions.ts`) runs `isLiveStaff` before every card action, so a demoted or removed account loses sighting immediately rather than at token expiry (2026-08-15 `security-reviewer` pass). No code change: this row records why the next reviewer should not re-raise it. Extends H-14; raised by the 2026-08-14 `security-reviewer` pass (FU-20260814-self-declared-rollback-and-sighting-authority).

Part of the [human decision log](README.md#decision-register).
