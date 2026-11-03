import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { blockerLabelCopy } from "@/i18n/today-labels";
import { blockerFixFor } from "./blockers";
import { resolveCopy } from "./copy";
import type { ReadinessBlocker } from "./readiness";

const t = staffTranslator("en-US");
const words = (fix: ReturnType<typeof blockerFixFor>) =>
  fix ? resolveCopy(t, blockerLabelCopy(fix.label)) : null;

const ctx = {
  shopSlug: "reef-co",
  tripId: "trip-1",
  personId: "person-1",
  bookingId: "booking-1",
  fullName: "Priya Sharma",
};

describe("blockerFixFor", () => {
  it("points card evidence at the diver's record without pretending to act", () => {
    const blockers: ReadinessBlocker[] = [{ code: "certification_pending" }];
    const fix = blockerFixFor(blockers, ctx);
    expect(words(fix)).toBe("Open Priya’s record");
    expect(fix).toEqual({
      label: { how: "point", target: "diver", fullName: "Priya Sharma" },
      href: "/shop/reef-co/divers/person-1",
      sendsWaiver: false,
      bookingId: "booking-1",
    });
  });

  it("sends waiver work in place, anchored to the booking (roster is the fallback)", () => {
    const blockers: ReadinessBlocker[] = [{ code: "waiver_not_sent" }];
    const fix = blockerFixFor(blockers, ctx);
    expect(words(fix)).toBe("Send waiver");
    expect(fix).toEqual({
      label: { how: "send", code: "waiver_not_sent" },
      href: "/shop/reef-co/trips/trip-1#booking-booking-1",
      sendsWaiver: true,
      bookingId: "booking-1",
    });
  });

  it("resolves the worst blocker when several are present", () => {
    // medical_review (severity 0) outranks payment_due, and it points at the
    // **diver's own record**, not the roster: the physician's clearance is
    // recorded there and nowhere else (issue #1252).
    const blockers: ReadinessBlocker[] = [{ code: "payment_due" }, { code: "medical_review" }];
    expect(words(blockerFixFor(blockers, ctx))).toBe("Open Priya’s record");
  });

  it("returns null when there is nothing to fix", () => {
    expect(blockerFixFor([], ctx)).toBeNull();
  });
});

/**
 * The invariant that silently broke: the counter's blocked rows and the day
 * spine's diver rows sit one tap apart and must send a staffer to the same
 * place for the same diver. They used to compute that independently from six
 * identical lines each. Walking `BLOCKER_ACTIONS` rather than a hand-written
 * list means a blocker code added tomorrow is covered the day it exists.
 */
