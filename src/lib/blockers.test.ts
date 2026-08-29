import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { blockerFixFor } from "./blockers";
import type { ReadinessBlocker, ReadinessBlockerCode, ReadinessBlockerParams } from "./readiness";
import { BLOCKER_ACTIONS, diverBlockerAction } from "./today";

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
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Open Priya’s record",
      href: "/shop/reef-co/divers/person-1",
      sendsWaiver: false,
      bookingId: "booking-1",
    });
  });

  it("sends waiver work in place, anchored to the booking (roster is the fallback)", () => {
    const blockers: ReadinessBlocker[] = [{ code: "waiver_not_sent" }];
    expect(blockerFixFor(blockers, ctx)).toEqual({
      label: "Send waiver",
      href: "/shop/reef-co/trips/trip-1#booking-booking-1",
      sendsWaiver: true,
      bookingId: "booking-1",
    });
  });

  it("resolves the worst blocker when several are present", () => {
    // medical_review (severity 0) outranks payment_due, and lives on the roster.
    const blockers: ReadinessBlocker[] = [{ code: "payment_due" }, { code: "medical_review" }];
    expect(blockerFixFor(blockers, ctx)?.label).toBe("Open roster");
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
describe("blockerFixFor and diverBlockerAction agree on every blocker code", () => {
  const codes = Object.keys(BLOCKER_ACTIONS) as ReadinessBlockerCode[];

  /**
   * The codes whose sentence interpolates a value. Only Today renders that
   * sentence (as the row's detail), but a blocker built without its params
   * throws inside the translator, so the fixture has to be honest about which
   * codes carry what — see `readinessBlockerText`, `src/i18n/readiness-labels.ts`.
   */
  const PARAMS: Partial<Record<ReadinessBlockerCode, ReadinessBlockerParams>> = {
    certification_insufficient: { requiredLevel: "advanced_open_water" },
    specialty_missing: { specialty: "deep" },
    specialty_pending: { specialty: "deep" },
    specialty_import_unconfirmed: { specialty: "deep" },
    under_minimum_age: { age: 11, minimumAge: 12 },
  };

  it.each(codes)("%s points both surfaces at one destination", (code) => {
    const params = PARAMS[code];
    const blockers: ReadinessBlocker[] = [params ? { code, params } : { code }];
    const fix = blockerFixFor(blockers, ctx);
    const action = diverBlockerAction(
      {
        bookingId: ctx.bookingId,
        personId: ctx.personId,
        fullName: ctx.fullName,
        tripId: ctx.tripId,
        tripTitle: "Morning two-tank",
        startsAt: nowDate(),
        blockers,
      },
      ctx.shopSlug,
      nowDate(),
    );

    expect(fix).not.toBeNull();
    expect(action).not.toBeNull();
    expect(fix?.href).toBe(action?.href);
    expect(fix?.label).toBe(action?.actionLabel);
    expect(fix?.sendsWaiver).toBe(action?.waiver !== undefined);
  });

  it("returns null from both when nothing blocks the diver", () => {
    expect(blockerFixFor([], ctx)).toBeNull();
    expect(
      diverBlockerAction(
        {
          bookingId: ctx.bookingId,
          personId: ctx.personId,
          fullName: ctx.fullName,
          tripId: ctx.tripId,
          tripTitle: "Morning two-tank",
          startsAt: nowDate(),
          blockers: [],
        },
        ctx.shopSlug,
        nowDate(),
      ),
    ).toBeNull();
  });
});
