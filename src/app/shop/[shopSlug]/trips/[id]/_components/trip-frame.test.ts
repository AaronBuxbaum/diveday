import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { rollCallPlace, tripFrame } from "./trip-frame";

const at = (shown: Parameters<typeof rollCallPlace>[0]["shown"], more = {}) =>
  rollCallPlace({ door: true, editing: false, cancelled: false, shown, ...more });

describe("rollCallPlace", () => {
  it("is the hero only at Check-in and On the water", () => {
    expect(at("checkin")).toBe("hero");
    expect(at("water")).toBe("hero");
    expect(at("filling")).toBe("header");
    expect(at("ready")).toBe("header");
    expect(at("wrapped")).toBe("header");
  });

  it("keeps a quiet door on a cancelled trip and on Edit trip", () => {
    expect(at("water", { cancelled: true })).toBe("header");
    expect(at("checkin", { editing: true })).toBe("header");
  });

  it("waits in More before Roll call has a door", () => {
    expect(at("checkin", { door: false })).toBe("more");
  });
});

describe("tripFrame's ready count", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  const startsAt = new Date("2026-11-20T13:00:00Z");
  const endsAt = new Date("2026-11-20T18:00:00Z");
  const seat = (id: string) => ({ booking: { id, status: "booked" }, checkedIn: false });

  it("counts a guest with no readiness reading as not ready, never as ready", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const frame = tripFrame({
      clock: {
        startsAt,
        endsAt,
        now,
        timeZone: "America/New_York",
        stage: null,
        cancelled: false,
        meetingWindows: [{ startsAt, endsAt }],
      },
      trip: {
        title: "Two-Tank Reef",
        startsAt,
        endsAt,
        booked: 8,
        capacity: 12,
        sellableCapacity: 12,
        // No price and no course price: sold elsewhere, so Filling leads with readiness.
        priceCents: null,
        course: null,
        meetingPointLabel: null,
        meetingPointAddress: null,
        arrivalLandmark: null,
        arrivalParkingNote: null,
      },
      shop: {
        name: "Blue Mantis",
        timezone: "America/New_York",
        dockCallMinutes: 30,
        addressStreet: null,
        addressLocality: null,
        addressRegion: null,
        addressPostalCode: null,
        addressCountry: null,
      },
      roster: ids.map(seat),
      // Seven read ready; "h" has no reading at all.
      readiness: new Map(
        ids
          .filter((id) => id !== "h")
          .map((id) => [id, { readiness: { status: "ready" as const, blockers: [] } }]),
      ),
      notBack: 0,
      askedPhase: undefined,
      boatName: null,
      locale: "en-US",
      t: staffTranslator("en-US"),
    });
    expect(frame.sentence.headline).toContain("7 of 8 guests ready.");
    expect(frame.bar).toEqual({ booked: 7, capacity: 8 });
  });
});
