import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness } from "./readiness";
import {
  effectiveWaiverForBooking,
  releaseLapsedForBooking,
  WAIVER_SIGNATURE_VALIDITY_MS,
  waiverClockInstant,
} from "./waivers";

/**
 * **A release current today that lapses before the departure** (A§4 item 9,
 * decided in issue #2611). The release's two clocks are measured at the later
 * of now and the departure (`waiverClockInstant`), so the roster read today
 * already says what the dock will say on the morning of the dive: a diver whose
 * release lapses first is blocked days ahead, as a lapsed release.
 */
describe("a release that lapses between today and the departure", () => {
  const today = new Date("2026-07-18T12:00:00.000Z");
  const departure = new Date(today.getTime() + 21 * 24 * 60 * 60 * 1000);
  const departureEnds = new Date(departure.getTime() + 4 * 60 * 60 * 1000);
  // Signed 351 days ago: inside the year today, two weeks past it on the day.
  const signedAt = new Date(
    today.getTime() + 14 * 24 * 60 * 60 * 1000 - WAIVER_SIGNATURE_VALIDITY_MS,
  );
  const release = {
    id: "release-1",
    bookingId: "booking-1",
    personId: "person-1",
    status: "completed",
    templateVersion: 1,
    templateGeneration: 1,
    signedAt,
    completedAt: signedAt,
    supersededAt: null,
    expiresAt: signedAt,
    createdAt: signedAt,
  } as unknown as WaiverRecord;
  const waiverOnly = {
    requiresWaiver: true,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
  } as unknown as TripRequirement;

  function rosterAt(at: Date, trip = { startsAt: departure, endsAt: departureEnds }) {
    const resolution = {
      bookingWaiver: release,
      personSignedWaivers: [release],
      currentTemplateVersion: 1,
      now: waiverClockInstant({ now: at, ...trip }),
    };
    return calculateReadiness({
      requirement: waiverOnly,
      waiver: effectiveWaiverForBooking(resolution),
      releaseLapsed: releaseLapsedForBooking(resolution),
      certifications: [],
      paymentStatus: "paid",
      timezone: "UTC",
      now: at,
    });
  }

  it("reads as blocked on today's roster, as a lapsed release and not an unsent one", () => {
    const result = rosterAt(today);
    expect(result.status).toBe("blocked");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["waiver_lapsed"]);
  });

  it("reads the same on the morning of the dive", () => {
    const result = rosterAt(new Date(departure.getTime() - 3 * 60 * 60 * 1000));
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["waiver_lapsed"]);
  });

  it("stays cleared when the release outlasts the departure", () => {
    const early = { startsAt: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) };
    expect(
      rosterAt(today, {
        ...early,
        endsAt: new Date(early.startsAt.getTime() + 4 * 60 * 60 * 1000),
      }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("blocks a liveaboard on the day it ends, not the day it sails", () => {
    const sails = { startsAt: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000) };
    const returns = new Date(sails.startsAt.getTime() + 10 * 24 * 60 * 60 * 1000);
    const result = rosterAt(today, { ...sails, endsAt: returns });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["waiver_lapsed"]);
  });

  it("never measures earlier than now, so a trip under way is read as today", () => {
    const result = rosterAt(departure, { startsAt: today, endsAt: departureEnds });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["waiver_lapsed"]);
  });
});
