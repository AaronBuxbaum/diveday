import { describe, expect, it } from "vitest";
import {
  BOAT_SAFETY_HORIZON_DAYS,
  type BoatSafetyNotice,
  boatPaperNotices,
  boatSafetyNoticeIsUrgent,
  boatSafetyNotices,
  expiredBoatSafetyNotices,
  isSafetyKitKind,
  passengersAboveCertificate,
  type SafetyKitUnit,
  safetyKitNotices,
} from "./boat-safety";

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

  it("says a unit pulled to the bench is off for service", () => {
    // Assigned aboard and off the boat for repair is the same as not aboard:
    // the crew needs to know before they leave.
    expect(safetyKitNotices([unit({ status: "needs_service" })], TODAY)).toEqual([
      { code: "kit_off_service", gearItemId: "aed-1", label: "AED" },
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
  it("names each paper due inside the horizon, in its own word", () => {
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

  it("says nothing for a paper the shop never dated", () => {
    expect(boatPaperNotices(papers(), TODAY)).toEqual([]);
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
  const all = (aboard: number, certifiedPassengers: number | null) =>
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
      passengersAboard: aboard,
      todayLocal: TODAY,
    });

  it("leads with too many people aboard, then what has run out, then what is about to", () => {
    const codes = all(14, 12).map((notice: BoatSafetyNotice) =>
      notice.code === "kit_clock" ? `${notice.code}:${notice.clock}` : notice.code,
    );
    expect(codes).toEqual([
      "over_certificate",
      "kit_clock:expiry",
      "kit_off_service",
      "kit_clock:aed_pads",
      "paper",
    ]);
    expect(all(14, 12)[0]).toEqual({ code: "over_certificate", aboard: 14, limit: 12 });
  });

  it("says nothing about the certificate when the boat is within it", () => {
    expect(all(12, 12).some((notice) => notice.code === "over_certificate")).toBe(false);
  });

  it("is empty for a boat with nothing to say", () => {
    expect(
      boatSafetyNotices({
        boat: { certifiedPassengers: null, ...papers() },
        kit: [],
        passengersAboard: 30,
        todayLocal: TODAY,
      }),
    ).toEqual([]);
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
        passengersAboard: 20,
        todayLocal: TODAY,
      }),
    );
    // Not the certificate (that is one departure's fact, said on its manifest)
    // and not what is merely due soon.
    expect(notices).toEqual([expect.objectContaining({ clock: "aed_battery", expired: true })]);
  });
});

describe("boatSafetyNoticeIsUrgent", () => {
  it("is warning ink for what has gone wrong, quiet for a heads-up", () => {
    expect(boatSafetyNoticeIsUrgent({ code: "over_certificate", aboard: 13, limit: 12 })).toBe(
      true,
    );
    expect(boatSafetyNoticeIsUrgent({ code: "kit_off_service", gearItemId: "a", label: "A" })).toBe(
      true,
    );
    const paper = { code: "paper", paper: "insurance", dueOn: TODAY, days: 3 } as const;
    expect(boatSafetyNoticeIsUrgent({ ...paper, expired: true })).toBe(true);
    expect(boatSafetyNoticeIsUrgent({ ...paper, expired: false })).toBe(false);
  });
});
