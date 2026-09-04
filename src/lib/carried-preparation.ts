import type { Certification } from "@/db/schema";
import { validVerifiedCertification } from "./readiness";
import type { ShopWaiverStatus } from "./waivers";

/**
 * **What survives a day that did not happen** (issue #1197, delight report D37).
 *
 * A blown-out departure leaves a diver holding a link to a boat that is not
 * going. `/ready/[token]` already tells them so warmly and points at the public
 * schedule. What it could not say is that the work they did to be ready was not
 * wasted — and it was not: every record below is filed against the **person and
 * the shop**, not the seat that vanished, so nothing carries anything anywhere.
 * This names facts that are already true.
 *
 * **Show-only, by the owner's ruling on the ticket.** No offer, no automatic
 * rebooking, no notification.
 *
 * Two things are deliberately absent. **Money**, because what a blown-out
 * booking is owed is a per-booking staff decision — `callTripBlowout` leaves
 * every seat `booked` for exactly that reason — and the ticket's boundary
 * leaves it to a human. And a **gear reservation**, because that is a
 * date-ranged row under an exclusion constraint: it is held for a day nobody is
 * diving, and calling it "kept" would promise a date this cannot know.
 */
export type CarriedPreparation = "waiver" | "certification" | "fit";

/**
 * What this diver's shop still holds for them.
 *
 * **Facts in, never the absence of a blocker.** The first version of this read
 * `readiness.blockers` and asked which families were unblocked, which is wrong
 * in a way that only shows up on the diver it matters to: a departure that
 * required no certification produces no certification blocker, so a diver who
 * has never shown the shop a card would have been told their certification was
 * on file. The readiness engine answers "is this person cleared for *that*
 * boat"; this asks "what does the shop have", and they are not the same
 * question — which is why this takes the records themselves.
 *
 * An empty result is the ordinary shape for a diver who prepared nothing, not
 * an error: the surface renders nothing rather than an empty panel.
 */
export function carriedPreparation(input: {
  /** Where the diver stands with this shop's release, `shopWaiverStatus`. */
  waiver: ShopWaiverStatus;
  /** Their level cards at this shop, whatever status each is in. */
  certifications: readonly Certification[];
  /** Whether the shop holds their sizes (`rental_fit_profiles`). */
  hasRentalFit: boolean;
}): CarriedPreparation[] {
  const carried: CarriedPreparation[] = [];
  // `current` and nothing else. `expired` means they sign again, and
  // `medical_review` is an open question rather than a thing kept — neither is
  // reassuring to read on the day a trip was called off.
  if (input.waiver.state === "current") carried.push("waiver");
  // A card the shop has actually seen. A self-declared one is still only
  // somebody's word for it (ADR 20260820-attested-at-booking-verified-at-boarding),
  // and telling a diver it was kept would be the shop vouching for a claim it
  // has never checked.
  if (input.certifications.some(validVerifiedCertification)) carried.push("certification");
  if (input.hasRentalFit) carried.push("fit");
  return carried;
}
