import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { ReadinessBlocker } from "@/lib/readiness";
import { diverBlockerAction, filterActionsForRoles } from "./today";

const EN = staffTranslator("en-US");

const NOW = new Date("2026-07-20T14:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function blocker(code: ReadinessBlocker["code"]): ReadinessBlocker {
  return { code };
}

describe("diverBlockerAction", () => {
  const input = {
    bookingId: "b1",
    personId: "p1",
    fullName: "Maya Alvarez",
    tripId: "t1",
    tripTitle: "Reef Drift · 8:00 AM",
    startsAt: hoursFromNow(3),
    blockers: [blocker("waiver_not_sent")],
  };

  it("sends waiver work in place, keeping the verb and the booking payload", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW, EN);
    // href stays the row's real destination, the roster row.
    expect(result?.href).toBe("/shop/blue-reef/trips/t1#booking-b1");
    expect(result?.actionLabel).toBe("Send waiver");
    expect(result?.waiver).toEqual({ bookingIds: ["b1"] });
    expect(result?.subject).toBe("Maya Alvarez");
    expect(result?.urgency).toBe("imminent");
  });

  it("points card work at the person record instead of pretending to act", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("certification_pending")] },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.href).toBe("/shop/blue-reef/divers/p1");
    // The tap only opens the record, so the label points rather than commands.
    expect(result?.actionLabel).toBe("Open Maya’s record");
    expect(result?.waiver).toBeUndefined();
  });

  /**
   * H-20261008-cert-check-extension: a card still waiting for its check names its diver, so the shop
   * home can offer "Check with SSI" from the row. The cards themselves are the
   * read's to find (`withAgencyChecks`), and the row keeps its door.
   */
  it("names the diver on a pending card's row, and on no other kind", () => {
    const pending = diverBlockerAction(
      { ...input, blockers: [blocker("certification_pending")] },
      "blue-reef",
      NOW,
      EN,
    );
    expect(pending?.agencyCheck).toEqual({ personId: "p1", cards: [] });
    expect(pending?.href).toBe("/shop/blue-reef/divers/p1");

    for (const code of ["certification_missing", "nitrox_pending", "waiver_not_sent"] as const) {
      const other = diverBlockerAction(
        { ...input, blockers: [blocker(code)] },
        "blue-reef",
        NOW,
        EN,
      );
      expect(other?.agencyCheck).toBeUndefined();
    }
  });

  /**
   * A held seat (H-20260724-one-person-per-email): the human on this booking may not be the one whose
   * cards are on file, so no row offers to check that person's card with an
   * agency until a staffer confirms who it is, whichever blocker heads it.
   */
  it("offers no agency check on a held seat, even with a pending card", () => {
    for (const blockers of [
      [blocker("certification_pending"), blocker("identity_unconfirmed")],
      [blocker("identity_unconfirmed"), blocker("certification_pending")],
    ]) {
      for (const aboard of [false, true]) {
        const held = diverBlockerAction({ ...input, blockers, aboard }, "blue-reef", NOW, EN);
        expect(held?.agencyCheck).toBeUndefined();
      }
    }
  });

  it("says the headline blocker in a few words, and nothing about the rest", () => {
    // The record the row opens lists every blocker in full; the row names the
    // one the tap fixes (Aaron, 2026-10-05: "reduce the amount of copy").
    const result = diverBlockerAction(
      {
        ...input,
        blockers: [blocker("medical_review"), blocker("payment_due"), blocker("waiver_pending")],
      },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.detail).toBe("Medical answer needs a doctor’s sign-off.");
  });

  // Issue #2124: held seats get no readiness reminder until staff confirm who it is.
  it("says a held seat's reminders wait on the confirm", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("identity_unconfirmed")] },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.detail).toBe(
      "Booking matched on a guess. Confirm who this is before the waiver goes out.",
    );
  });

  it("says a cert gap without the levels, which the record carries", () => {
    const result = diverBlockerAction(
      {
        ...input,
        blockers: [
          {
            code: "certification_insufficient",
            params: { requiredLevel: "advanced_open_water", heldLevel: "open_water" },
          },
        ],
      },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.detail).toBe("Not certified for this trip");
  });

  it("leads an aboard diver's row with the missing waiver, not the card", () => {
    // Aboard, an unsigned waiver is a missing medical declaration; ashore the
    // card ranks first because it takes longer to fix (dive-domain-expert).
    const blockers = [blocker("certification_insufficient"), blocker("waiver_pending")];
    expect(diverBlockerAction({ ...input, blockers }, "blue-reef", NOW, EN)?.detail).toBe(
      "Not certified for this trip",
    );
    const aboard = diverBlockerAction({ ...input, blockers, aboard: true }, "blue-reef", NOW, EN);
    expect(aboard?.kind).toBe("blocked_aboard");
    expect(aboard?.detail).toBe("Waiver not signed, link sent");
  });

  it("never makes an Aboard row out of money owed", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_due")], aboard: true },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.kind).toBe("payment");
  });

  it("says a medical hold aboard as a doctor's call, to the boat roles too", () => {
    // Deliberate: the departure card said "a medical hold" by name to every
    // Today viewer before this row replaced it, and the person at the rail is
    // who needs to know (dive-domain-expert and security-reviewer, 2026-10-05).
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("medical_review")], aboard: true },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.detail).toBe("Medical answer needs a doctor’s sign-off.");
    if (!result) throw new Error("expected a row");
    expect(filterActionsForRoles([result], ["captain"])).toHaveLength(1);
    expect(filterActionsForRoles([result], ["divemaster"])).toHaveLength(1);
  });

  it("takes the aboard kind once the diver is on the boat, keeping the fix", () => {
    const result = diverBlockerAction({ ...input, aboard: true }, "blue-reef", NOW, EN);
    expect(result?.kind).toBe("blocked_aboard");
    expect(result?.detail).toBe("Waiver not signed, not sent yet");
    expect(result?.waiver).toEqual({ bookingIds: ["b1"] });
  });

  it("produces nothing for a diver with no blockers", () => {
    expect(diverBlockerAction({ ...input, blockers: [] }, "blue-reef", NOW, EN)).toBeNull();
  });

  it("marks a payment_due row with the single booking it can act on in place", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_due")] },
      "blue-reef",
      NOW,
      EN,
    );
    // Only the bookingId — src/features/today/today-reader.ts fills in orderId/hostedInvoiceUrl
    // once it knows the booking was actually invoiced through Stripe.
    expect(result?.payment).toEqual({ bookingId: "b1" });
    expect(result?.payment?.orderId).toBeUndefined();
  });

  it("marks a payment_refunded row the same way", () => {
    const result = diverBlockerAction(
      { ...input, blockers: [blocker("payment_refunded")] },
      "blue-reef",
      NOW,
      EN,
    );
    expect(result?.payment).toEqual({ bookingId: "b1" });
  });

  it("never marks a non-payment row for the inline payment control", () => {
    const result = diverBlockerAction(input, "blue-reef", NOW, EN);
    expect(result?.payment).toBeUndefined();
  });
});
