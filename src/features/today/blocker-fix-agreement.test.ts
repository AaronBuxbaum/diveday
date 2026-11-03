import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { BLOCKER_ACTIONS, blockerFixFor } from "@/lib/blockers";
import { nowDate } from "@/lib/clock";
import { resolveCopy } from "@/lib/copy";
import type {
  ReadinessBlocker,
  ReadinessBlockerCode,
  ReadinessBlockerParams,
} from "@/lib/readiness";
import { diverBlockerAction } from "./index";

const t = staffTranslator("en-US");
const words = (fix: ReturnType<typeof blockerFixFor>) => (fix ? resolveCopy(t, fix.label) : null);

const ctx = {
  shopSlug: "reef-co",
  tripId: "trip-1",
  personId: "person-1",
  bookingId: "booking-1",
  fullName: "Priya Sharma",
};

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
    certification_in_training: { requiredLevel: "advanced_open_water" },
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
    expect(words(fix)).toBe(action?.actionLabel);
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
