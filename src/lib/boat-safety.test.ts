import { describe, expect, it } from "vitest";
import {
  BOAT_PAPER_HORIZON_DAYS,
  BOAT_SAFETY_HORIZON_DAYS,
  type BoatSafetyNotice,
  boatPaperNotices,
  boatSafetyNoticeIsUrgent,
  boatSafetyNotices,
  boatSafetyNoticeTone,
  boatSeatsRefusal,
  departureSafetyDate,
  expiredBoatSafetyNotices,
  isLifeSafetyKitKind,
  isSafetyKitKind,
  kitMissingNotices,
  lifeSafetyNotices,
  passengersAboveCertificate,
  type SafetyKitUnit,
  safetyKitNotices,
} from "./boat-safety";
import type { GearItemKind } from "./gear";

const TODAY = "2026-10-09";

const unit = (overrides: Partial<SafetyKitUnit> = {}): SafetyKitUnit => ({
  id: "aed-1",
  label: "AED",
  kind: "aed",
  status: "in_service",
  clocks: [],
  ...overrides,
});

const papers = (overrides: Partial<Parameters<typeof boatPaperNotices>[0]> = {}) => ({
  inspectionDueOn: null,
  registrationExpiresOn: null,
  insuranceExpiresOn: null,
  ...overrides,
});

describe("isSafetyKitKind", () => {
  it("names the four kinds a boat carries for an emergency", () => {
    for (const kind of ["o2_kit", "aed", "first_aid_kit", "flares"] as const) {
      expect(isSafetyKitKind(kind)).toBe(true);
    }
  });

  it("does not treat rental gear as safety kit", () => {
    // A tank or a regulator aboard is a rental unit with a diver's name on it,
    // not the boat's own emergency equipment.
    for (const kind of ["tank", "regulator", "bcd", "other"] as const) {
      expect(isSafetyKitKind(kind)).toBe(false);
    }
  });
});

describe("safetyKitNotices", () => {
  it("says the AED's pads expire in 12 days", () => {
    const notices = safetyKitNotices(
      [unit({ clocks: [{ kind: "aed_pads", servicedOn: "2024-10-21", nextDueOn: "2026-10-21" }] })],
      TODAY,
    );
    expect(notices).toEqual([
      {
        code: "kit_clock",
        gearItemId: "aed-1",
        label: "AED",
        kind: "aed",
        clock: "aed_pads",
        dueOn: "2026-10-21",
        expired: false,
        days: 12,
      },
    ]);
  });

  it("says flares expired 3 days ago", () => {
    const notices = safetyKitNotices(
      [
        unit({
          id: "flares-1",
          label: "Flares",
          kind: "flares",
          clocks: [{ kind: "expiry", servicedOn: "2023-04-01", nextDueOn: "2026-10-06" }],
        }),
      ],
      TODAY,
    );
    expect(notices).toEqual([
      expect.objectContaining({ code: "kit_clock", clock: "expiry", expired: true, days: 3 }),
    ]);
  });

  it("speaks for every clock that is due, not only the worst one", () => {
    // Pads and battery are replaced on their own schedules; naming only the
    // battery would leave the crew believing the pads are fine.
    const notices = safetyKitNotices(
      [
        unit({
          clocks: [
            { kind: "aed_pads", servicedOn: "2024-10-21", nextDueOn: "2026-10-21" },
            { kind: "aed_battery", servicedOn: "2022-10-01", nextDueOn: "2026-10-01" },
          ],
        }),
      ],
      TODAY,
    );
    expect(notices.map((notice) => notice.code === "kit_clock" && notice.clock)).toEqual([
      "aed_battery",
      "aed_pads",
    ]);
  });

  it("is silent past the 30-day horizon and speaks on its last day", () => {
    const at = (nextDueOn: string) =>
      safetyKitNotices(
        [unit({ clocks: [{ kind: "aed_pads", servicedOn: "2024-01-01", nextDueOn }] })],
        TODAY,
      );
    expect(BOAT_SAFETY_HORIZON_DAYS).toBe(30);
    expect(at("2026-11-08")).toHaveLength(1); // 30 days
    expect(at("2026-11-09")).toEqual([]); // 31 days
  });

  it("reads the expiry date itself as the last good day, not an expired one", () => {
    const [notice] = safetyKitNotices(
      [unit({ clocks: [{ kind: "aed_pads", servicedOn: "2024-01-01", nextDueOn: TODAY }] })],
      TODAY,
    );
    expect(notice).toEqual(expect.objectContaining({ expired: false, days: 0 }));
  });

  it("ignores a clock the shop turned off with no next date", () => {
    expect(
      safetyKitNotices(
        [unit({ clocks: [{ kind: "aed_pads", servicedOn: "2026-01-01", nextDueOn: null }] })],
        TODAY,
      ),
    ).toEqual([]);
  });

  it("says a unit flagged for service, without claiming where it is", () => {
    // The register knows the flag, not whether the unit left the boat: the
    // crew are told to check, before they leave.
    expect(safetyKitNotices([unit({ status: "needs_service" })], TODAY)).toEqual([
      { code: "kit_off_service", gearItemId: "aed-1", label: "AED", kind: "aed" },
    ]);
  });

  it("says nothing about a unit that is in date", () => {
    expect(
      safetyKitNotices(
        [
          unit({
            clocks: [{ kind: "aed_pads", servicedOn: "2026-01-01", nextDueOn: "2028-01-01" }],
          }),
        ],
        TODAY,
      ),
    ).toEqual([]);
  });
});

describe("boatPaperNotices", () => {
  it("names each paper due inside its own horizon, in its own word", () => {
    expect(
      boatPaperNotices(
        papers({
          inspectionDueOn: "2026-10-20",
          registrationExpiresOn: "2026-10-01",
          insuranceExpiresOn: "2027-06-01",
        }),
        TODAY,
      ),
    ).toEqual([
      { code: "paper", paper: "registration", dueOn: "2026-10-01", expired: true, days: 8 },
      { code: "paper", paper: "inspection", dueOn: "2026-10-20", expired: false, days: 11 },
    ]);
  });

  it("looks 90 days ahead for the inspection and 60 for registration and insurance", () => {
    // Booking an inspection or renewing a policy takes weeks; new pads are a
    // parcel. The papers' windows are wider than the kit's 30 days.
    expect(BOAT_PAPER_HORIZON_DAYS).toEqual({ inspection: 90, registration: 60, insurance: 60 });
    const at = (key: "inspectionDueOn" | "insuranceExpiresOn", dueOn: string) =>
      boatPaperNotices(papers({ [key]: dueOn }), TODAY).length;
    expect(at("inspectionDueOn", "2027-01-07")).toBe(1); // 90 days
    expect(at("inspectionDueOn", "2027-01-08")).toBe(0); // 91 days
    expect(at("insuranceExpiresOn", "2026-12-08")).toBe(1); // 60 days
    expect(at("insuranceExpiresOn", "2026-12-09")).toBe(0); // 61 days
  });

  it("says nothing for a paper the shop never dated", () => {
    expect(boatPaperNotices(papers(), TODAY)).toEqual([]);
  });
});

describe("kitMissingNotices", () => {
  const onRegister = (...kinds: GearItemKind[]) => new Set<GearItemKind>(kinds);

  it("says a hull lacks the O2 kit and AED a shop keeps", () => {
    expect(kitMissingNotices([], onRegister("o2_kit", "aed"))).toEqual([
      { code: "kit_missing", kind: "o2_kit" },
      { code: "kit_missing", kind: "aed" },
    ]);
  });

  it("is silent about a kind the shop has never registered", () => {
    // Opt-in by presence: a shop with no AED on the register is never told a
    // boat lacks one.
    expect(kitMissingNotices([], onRegister("flares", "first_aid_kit"))).toEqual([]);
  });

  it("does not count a unit flagged for service as aboard", () => {
    expect(
      kitMissingNotices(
        [
          { kind: "o2_kit", status: "needs_service" },
          { kind: "aed", status: "in_service" },
        ],
        onRegister("o2_kit", "aed"),
      ),
    ).toEqual([{ code: "kit_missing", kind: "o2_kit" }]);
  });

  it("never asks for flares or a first-aid kit by absence", () => {
    // Only oxygen and the AED are must-carry; the other kinds speak through
    // their own clocks.
    expect(kitMissingNotices([], onRegister("flares", "first_aid_kit", "aed"))).toEqual([
      { code: "kit_missing", kind: "aed" },
    ]);
  });
});

describe("passengersAboveCertificate", () => {
  it("is true only when the people booked pass the certificate", () => {
    expect(passengersAboveCertificate(13, 12)).toBe(true);
    expect(passengersAboveCertificate(12, 12)).toBe(false);
    expect(passengersAboveCertificate(4, 12)).toBe(false);
  });

  it("never reads a missing certificate as a limit of zero", () => {
    expect(passengersAboveCertificate(40, null)).toBe(false);
  });
});

describe("boatSafetyNotices", () => {
  const all = (
    passengers: { booked: number; boarded: number },
    certifiedPassengers: number | null,
    kindsOnRegister: GearItemKind[] = ["aed", "flares", "o2_kit"],
  ) =>
    boatSafetyNotices({
      boat: { certifiedPassengers, ...papers({ insuranceExpiresOn: "2026-10-30" }) },
      kit: [
        unit({ clocks: [{ kind: "aed_pads", servicedOn: "2024-10-21", nextDueOn: "2026-10-21" }] }),
        unit({
          id: "flares-1",
          label: "Flares",
          kind: "flares",
          clocks: [{ kind: "expiry", servicedOn: "2023-04-01", nextDueOn: "2026-10-06" }],
        }),
        unit({ id: "o2", label: "O2 kit", kind: "o2_kit", status: "needs_service" }),
      ],
      kindsOnRegister: new Set(kindsOnRegister),
      passengers,
      onDate: TODAY,
    });

  it("leads with missing oxygen, then too many aboard, then what has run out, then what is about to", () => {
    const codes = all({ booked: 14, boarded: 0 }, 12).map((notice: BoatSafetyNotice) =>
      notice.code === "kit_clock" ? `${notice.code}:${notice.clock}` : notice.code,
    );
    expect(codes).toEqual([
      "kit_missing",
      "over_certificate",
      "kit_clock:expiry",
      "kit_off_service",
      "kit_clock:aed_pads",
      "paper",
    ]);
    expect(all({ booked: 14, boarded: 0 }, 12)[1]).toEqual({
      code: "over_certificate",
      passengers: 14,
      limit: 12,
      counted: false,
    });
  });

  it("counts the people recorded aboard once there are more of them than the certificate allows", () => {
    const over = (passengers: { booked: number; boarded: number }) =>
      all(passengers, 12).find((notice) => notice.code === "over_certificate");
    expect(over({ booked: 14, boarded: 13 })).toEqual({
      code: "over_certificate",
      passengers: 13,
      limit: 12,
      counted: true,
    });
    // Halfway up the gangway the list still says it: the line never vanishes
    // because boarding has started.
    expect(over({ booked: 14, boarded: 5 })).toEqual({
      code: "over_certificate",
      passengers: 14,
      limit: 12,
      counted: false,
    });
  });

  it("says nothing about the certificate when the boat is within it", () => {
    expect(
      all({ booked: 12, boarded: 12 }, 12).some((notice) => notice.code === "over_certificate"),
    ).toBe(false);
  });

  it("judges each clock against the departure's own date", () => {
    const next = (onDate: string) =>
      boatSafetyNotices({
        boat: { certifiedPassengers: null, ...papers() },
        kit: [
          unit({
            clocks: [{ kind: "aed_pads", servicedOn: "2024-10-21", nextDueOn: "2026-10-21" }],
          }),
        ],
        kindsOnRegister: new Set(["aed"]),
        passengers: { booked: 4, boarded: 0 },
        onDate,
      });
    expect(next(TODAY)).toEqual([expect.objectContaining({ expired: false, days: 12 })]);
    // The same pads, on a departure the week after they lapse.
    expect(next("2026-10-28")).toEqual([expect.objectContaining({ expired: true, days: 7 })]);
  });

  it("is empty for a boat with nothing to say", () => {
    expect(
      boatSafetyNotices({
        boat: { certifiedPassengers: null, ...papers() },
        kit: [],
        kindsOnRegister: new Set(),
        passengers: { booked: 30, boarded: 0 },
        onDate: TODAY,
      }),
    ).toEqual([]);
  });
});

describe("lifeSafetyNotices", () => {
  it("keeps missing must-carry kit and the oxygen, AED and flare clocks, nothing else", () => {
    const notices = boatSafetyNotices({
      boat: {
        certifiedPassengers: 4,
        ...papers({ insuranceExpiresOn: "2026-10-01" }),
      },
      kit: [
        unit({
          id: "flares-1",
          label: "Flares",
          kind: "flares",
          clocks: [{ kind: "expiry", servicedOn: "2023-04-01", nextDueOn: "2026-10-30" }],
        }),
        unit({
          id: "fak",
          label: "First aid",
          kind: "first_aid_kit",
          clocks: [{ kind: "expiry", servicedOn: "2023-04-01", nextDueOn: "2026-10-01" }],
        }),
      ],
      kindsOnRegister: new Set(["aed", "flares", "first_aid_kit"]),
      passengers: { booked: 9, boarded: 0 },
      onDate: TODAY,
    });
    expect(lifeSafetyNotices(notices)).toEqual([
      { code: "kit_missing", kind: "aed" },
      expect.objectContaining({ code: "kit_clock", kind: "flares", expired: false, days: 21 }),
    ]);
  });

  it("names the three life-safety kinds", () => {
    expect(
      ["o2_kit", "aed", "flares"].every((kind) => isLifeSafetyKitKind(kind as GearItemKind)),
    ).toBe(true);
    expect(isLifeSafetyKitKind("first_aid_kit")).toBe(false);
  });
});

describe("expiredBoatSafetyNotices", () => {
  it("keeps only what has already run out, for Today's owner row", () => {
    const notices = expiredBoatSafetyNotices(
      boatSafetyNotices({
        boat: { certifiedPassengers: 12, ...papers({ insuranceExpiresOn: "2026-10-30" }) },
        kit: [
          unit({
            clocks: [
              { kind: "aed_pads", servicedOn: "2024-10-21", nextDueOn: "2026-10-21" },
              { kind: "aed_battery", servicedOn: "2022-10-01", nextDueOn: "2026-10-01" },
            ],
          }),
        ],
        kindsOnRegister: new Set(["aed", "o2_kit"]),
        passengers: { booked: 20, boarded: 0 },
        onDate: TODAY,
      }),
    );
    // Not the certificate or missing kit (one departure's facts, said on its
    // manifest) and not what is merely due soon.
    expect(notices).toEqual([expect.objectContaining({ clock: "aed_battery", expired: true })]);
  });
});

describe("boatSafetyNoticeTone", () => {
  it("is danger for missing kit and too many aboard, warning for what has gone wrong, neutral for a heads-up", () => {
    expect(
      boatSafetyNoticeTone({ code: "over_certificate", passengers: 13, limit: 12, counted: true }),
    ).toBe("danger");
    expect(boatSafetyNoticeTone({ code: "kit_missing", kind: "o2_kit" })).toBe("danger");
    expect(
      boatSafetyNoticeTone({ code: "kit_off_service", gearItemId: "a", label: "A", kind: "aed" }),
    ).toBe("warning");
    const paper = { code: "paper", paper: "insurance", dueOn: TODAY, days: 3 } as const;
    expect(boatSafetyNoticeTone({ ...paper, expired: true })).toBe("warning");
    expect(boatSafetyNoticeTone({ ...paper, expired: false })).toBe("neutral");
    expect(boatSafetyNoticeIsUrgent({ ...paper, expired: false })).toBe(false);
    expect(boatSafetyNoticeIsUrgent({ code: "kit_missing", kind: "aed" })).toBe(true);
  });
});

describe("departureSafetyDate", () => {
  const ZONE = "America/New_York";
  const now = new Date("2026-10-09T13:30:00Z"); // 09:30 in Key Largo

  it("is the departure's own local day, today or later", () => {
    expect(departureSafetyDate(new Date("2026-10-09T23:30:00Z"), now, ZONE)).toBe("2026-10-09");
    expect(departureSafetyDate(new Date("2026-10-16T12:00:00Z"), now, ZONE)).toBe("2026-10-16");
  });

  it("is null once the departure's day is behind the shop", () => {
    // 21:00 on the 8th in Key Largo, though already the 9th in UTC.
    expect(departureSafetyDate(new Date("2026-10-09T01:00:00Z"), now, ZONE)).toBeNull();
  });

  it("still speaks for this morning's boat that has already left", () => {
    expect(departureSafetyDate(new Date("2026-10-09T11:00:00Z"), now, ZONE)).toBe("2026-10-09");
  });
});

describe("boatSeatsRefusal (H-107)", () => {
  it("refuses seats on sale above the certificate, in either direction of edit", () => {
    expect(boatSeatsRefusal({ capacity: 14, certifiedPassengers: 12 })).toEqual({
      code: "seats_above_certificate",
      capacity: 14,
      limit: 12,
    });
    // Lowering the certificate under the seats is the same refusal.
    expect(boatSeatsRefusal({ capacity: 12, certifiedPassengers: 11 })).toMatchObject({
      code: "seats_above_certificate",
    });
  });

  it("lets seats up to the certificate through, and a boat with no certificate", () => {
    expect(boatSeatsRefusal({ capacity: 12, certifiedPassengers: 12 })).toBeNull();
    expect(boatSeatsRefusal({ capacity: 6, certifiedPassengers: 12 })).toBeNull();
    expect(boatSeatsRefusal({ capacity: 40, certifiedPassengers: null })).toBeNull();
  });

  it("refuses a certificate under an upcoming departure's own seats, and counts them", () => {
    expect(
      boatSeatsRefusal({
        capacity: 10,
        certifiedPassengers: 10,
        upcomingDepartureCapacities: [10, 12, 14, 8],
      }),
    ).toEqual({ code: "departures_above_certificate", departures: 2, limit: 10 });
    expect(
      boatSeatsRefusal({
        capacity: 10,
        certifiedPassengers: 10,
        upcomingDepartureCapacities: [10, 8],
      }),
    ).toBeNull();
  });

  it("names the hull's own seats first when both are over", () => {
    expect(
      boatSeatsRefusal({
        capacity: 14,
        certifiedPassengers: 10,
        upcomingDepartureCapacities: [14],
      }),
    ).toMatchObject({ code: "seats_above_certificate" });
  });
});
