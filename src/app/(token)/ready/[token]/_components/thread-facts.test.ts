import { describe, expect, it } from "vitest";
import type { TripRequirement } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import type { ThreadStep } from "@/lib/thread-steps";
import type { ReadyPageData } from "../../../../../features/ready/store";
import { boatStageLine, readyBoatStageLine, readyStepLine, readyThreadFacts } from "./thread-facts";

const [ENGLISH] = DIVER_LOCALES;
const t = diverTranslator(ENGLISH);

function requirement(overrides: Partial<TripRequirement> = {}): TripRequirement {
  return {
    shopId: "shop",
    tripId: "trip",
    requiresWaiver: true,
    minimumCertificationLevel: "advanced_open_water",
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: true,
    createdAt: nowDate(),
    updatedAt: nowDate(),
    ...overrides,
  } as TripRequirement;
}

function data(overrides: Record<string, unknown> = {}): ReadyPageData {
  return {
    detail: {
      requirement: requirement(),
      siteRequirement: null,
      readiness: {
        status: "blocked",
        blockers: [{ code: "certification_missing" }, { code: "payment_due" }],
      },
    },
    shop: { currency: "usd", rentalItems: ["nitrox"] },
    trip: { seatPriceCents: 18_000, course: null },
    rentalFit: null,
    lastDivedBand: null,
    nitroxCardVerified: false,
    nitroxCardOnFile: false,
    bookingCreatedAt: new Date("2026-07-20T12:00:00Z"),
    ...overrides,
  } as unknown as ReadyPageData;
}

describe("readyThreadFacts", () => {
  it("quotes the seat's fare as the amount due, and nothing without the trip on record", () => {
    const facts = readyThreadFacts(data(), true, ENGLISH);
    expect(facts.fullPriceCents).toBe(18_000);
    expect(facts.amountDueText).toBe("$180.00");
    const unpriced = readyThreadFacts(data(), false, ENGLISH);
    expect(unpriced.fullPriceCents).toBeNull();
    expect(unpriced.amountDueText).toBeNull();
  });

  it("names the rung the departure demands", () => {
    expect(readyThreadFacts(data(), true, ENGLISH).requiredLevel).toBe("advanced_open_water");
  });

  it("asks whether the gear and recency questions were answered, not what the answers were", () => {
    const blank = readyThreadFacts(data(), true, ENGLISH);
    expect(blank.hasRentalFit).toBe(false);
    expect(blank.hasLastDived).toBe(false);
    const answered = readyThreadFacts(
      data({
        rentalFit: { fitStatedAt: new Date("2026-07-21T09:00:00Z") },
        lastDivedBand: "never",
      }),
      true,
      ENGLISH,
    );
    expect(answered.hasRentalFit).toBe(true);
    expect(answered.hasLastDived).toBe(true);
  });

  it("carries facts only when the sizes predate this booking", () => {
    const before = data({ rentalFit: { fitStatedAt: new Date("2026-06-01T09:00:00Z") } });
    const after = data({ rentalFit: { fitStatedAt: new Date("2026-07-21T09:00:00Z") } });
    expect(readyThreadFacts(before, true, ENGLISH).carriedFacts).toBe(true);
    expect(readyThreadFacts(after, true, ENGLISH).carriedFacts).toBe(false);
  });

  it("offers the nitrox card only where a certification step can carry it", () => {
    expect(readyThreadFacts(data(), true, ENGLISH).nitroxCardEntryOffered).toBe(true);
    const noCertStep = data({
      detail: {
        requirement: requirement({ minimumCertificationLevel: null }),
        siteRequirement: null,
        readiness: { status: "ready", blockers: [] },
      },
    });
    expect(readyThreadFacts(noCertStep, true, ENGLISH).nitroxCardEntryOffered).toBe(false);
    const cardOnFile = data({ nitroxCardOnFile: true });
    expect(readyThreadFacts(cardOnFile, true, ENGLISH).nitroxCardEntryOffered).toBe(false);
  });
});

describe("readyStepLine", () => {
  const facts = readyThreadFacts(data(), true, ENGLISH);
  const certItem = facts.items.find((item) => item.category === "certification");
  const payItem = facts.items.find((item) => item.category === "payment");

  function step(overrides: Partial<ThreadStep>): ThreadStep {
    return { id: "gear", state: "your_turn", ...overrides } as ThreadStep;
  }

  it("names the minimum level on the certification step", () => {
    const line = readyStepLine(step({ id: "certification", item: certItem }), {
      t,
      facts,
      lastDivedBand: null,
      paidLine: "$180",
    });
    expect(line).toContain("Advanced Open Water");
  });

  it("states the amount on an unpaid Pay step and the receipt on a settled one", () => {
    const due = readyStepLine(step({ id: "pay", item: payItem }), {
      t,
      facts,
      lastDivedBand: null,
      paidLine: "$180",
    });
    expect(due).toContain("$180.00");
    const paid = readyStepLine(step({ id: "pay", state: "done", item: payItem }), {
      t,
      facts,
      lastDivedBand: null,
      paidLine: "$180 paid",
    });
    expect(paid).toBe("$180 paid");
  });

  it("says nothing on an unanswered gear step", () => {
    expect(
      readyStepLine(step({ id: "gear" }), { t, facts, lastDivedBand: null, paidLine: "" }),
    ).toBeNull();
  });
});

describe("boatStageLine", () => {
  const trip = {
    title: "Two-Tank Reef",
    startsAt: new Date("2026-07-21T12:00:00Z"),
    endsAt: new Date("2026-07-21T18:00:00Z"),
  };

  it("is silent when the crew has said nothing", () => {
    expect(boatStageLine(null, trip, "America/New_York", ENGLISH, t)).toBeNull();
  });

  it("names the boat and when the crew said it", () => {
    const line = boatStageLine(
      {
        stage: "underway",
        siteName: null,
        recordedAt: new Date("2026-07-21T13:00:00Z"),
      } as Parameters<typeof boatStageLine>[0],
      trip,
      "America/New_York",
      ENGLISH,
      t,
    );
    expect(line?.sentence).toContain("Two-Tank Reef");
    expect(line?.said).toContain("9:00");
  });
});

describe("boatStageLine public day eligibility", () => {
  it.each([
    ["days early", "2026-07-23T12:00:00Z", "2026-07-23T16:00:00Z", "2026-07-21T13:00:00Z"],
    [
      "previous local day on the same UTC date",
      "2026-07-21T12:00:00Z",
      "2026-07-21T16:00:00Z",
      "2026-07-21T03:59:59Z",
    ],
    [
      "previous meeting day",
      "2026-07-20T12:00:00Z",
      "2026-07-22T16:00:00Z",
      "2026-07-20T13:00:00Z",
    ],
  ])("does not publish %s evidence", (_name, start, end, at) => {
    const trip = { title: "Day-scoped boat", startsAt: new Date(start), endsAt: new Date(end) };
    const raw = {
      stage: "underway",
      siteName: null,
      recordedAt: new Date(at),
      recordedByName: "Crew",
    } as const;
    expect(boatStageLine(raw, trip, "America/New_York", ENGLISH, t)).toBeNull();
    expect(raw.recordedAt.toISOString()).toBe(new Date(at).toISOString());
  });
});

it("uses ready data's overnight meeting window when composing the public line", () => {
  const ready = data({
    detail: {
      trip: {
        title: "Night boat",
        startsAt: new Date("2026-07-20T12:00:00Z"),
        endsAt: new Date("2026-07-22T18:00:00Z"),
      },
      shop: { timezone: "America/New_York" },
    },
    meetingDays: [
      { startsAt: new Date("2026-07-21T02:00:00Z"), endsAt: new Date("2026-07-21T14:00:00Z") },
      { startsAt: new Date("2026-07-22T12:00:00Z"), endsAt: new Date("2026-07-22T18:00:00Z") },
    ],
  });
  expect(
    readyBoatStageLine(
      {
        stage: "underway",
        siteName: null,
        recordedAt: new Date("2026-07-21T03:30:00Z"),
        recordedByName: null,
      },
      ready,
      ENGLISH,
      t,
    )?.sentence,
  ).toContain("Night boat");
});
