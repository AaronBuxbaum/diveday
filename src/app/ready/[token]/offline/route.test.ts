import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyBookingCapability = vi.fn();
const getReadyPageData = vi.fn();

vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/booking-capabilities", () => ({
  verifyBookingCapability: (...args: unknown[]) => verifyBookingCapability(...args),
}));
vi.mock("@/db/ready", () => ({
  getReadyPageData: (...args: unknown[]) => getReadyPageData(...args),
}));
const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
  rateLimitKey: (...parts: string[]) => parts.join(":"),
  RATE_LIMITS: { capabilityAction: { limit: 60, windowSeconds: 3600 } },
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: async () => "203.0.113.9" }));
vi.mock("@/db/shops", () => ({
  getShopBySlug: async () => ({ packingList: ["Reef-safe sunscreen"], briefingMinutes: 15 }),
}));
vi.mock("@/db/trips", () => ({
  listTripDives: async () => [{ diveSite: { name: "Palancar Reef" } }],
}));
vi.mock("@/db/trip-change-events", () => ({ listTripChangeEvents: async () => [] }));
vi.mock("@/db/fly-safe-plan", () => ({ readPlannedFlySafe: async () => null }));
vi.mock("@/lib/readiness-summary", () => ({
  buildDiverChecklist: () => [
    { state: "done", detailCode: "waiver_done" },
    { state: "action", detailCode: "certification_missing" },
  ],
}));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));

import { GET } from "./route";

const TOKEN = "T".repeat(43);
const call = () =>
  GET(new Request(`https://dive.day/ready/${TOKEN}/offline`), {
    params: Promise.resolve({ token: TOKEN }),
  });

/** Everything the page loader holds, including what a snapshot must never carry. */
function pageData(overrides: Record<string, unknown> = {}) {
  return {
    detail: {
      cancelled: false,
      shop: { name: "Blue Mantis Dive", timezone: "America/Cancun" },
      trip: {
        id: "trip-uuid-secret",
        title: "Two-Tank Reef",
        startsAt: new Date("2099-01-02T13:00:00Z"),
        endsAt: new Date("2099-01-02T17:00:00Z"),
      },
    },
    departureCancelled: false,
    seatReleased: false,
    identityHeld: false,
    pickupTime: null,
    hotelPickupLocation: null,
    bookingCreatedAt: new Date("2098-12-01T00:00:00Z"),
    participantType: "diver",
    rentalFit: null,
    shop: {
      id: "shop-1",
      slug: "blue-mantis",
      defaultLocale: "en-US",
      contactPhone: "+52 984 555 0100",
      contactEmail: "dock@bluemantis.example",
      address: {
        street: "1 Malecon",
        locality: "Cozumel",
        region: null,
        postalCode: null,
        country: null,
      },
      dockCallMinutes: 30,
      rentalItems: ["secret rental"],
    },
    trip: {
      id: "trip-uuid-secret",
      course: null,
      meetingPointLabel: null,
      meetingPointAddress: null,
      arrivalLandmark: "Blue awning",
      arrivalParkingNote: null,
      arrivalTransitNote: null,
      arrivalLookFor: null,
      arrivalFirstInteraction: null,
      seatPriceCents: 987654,
    },
    person: { id: "person-secret", email: "diver@example.com", locale: null },
    emergencyContact: { name: "Sam", phone: "555-0199" },
    greetingName: "Secret Diver",
    ...overrides,
  };
}

beforeEach(() => {
  verifyBookingCapability.mockReset();
  getReadyPageData.mockReset();
  checkRateLimit.mockReset();
  checkRateLimit.mockResolvedValue({ allowed: true });
  verifyBookingCapability.mockResolvedValue({ bookingId: "booking-secret", shopId: "shop-1" });
  getReadyPageData.mockResolvedValue(pageData());
});

describe("GET /ready/[token]/offline", () => {
  it("answers a live booking's snapshot, read with the readiness capability", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(verifyBookingCapability).toHaveBeenCalledWith(expect.anything(), {
      token: TOKEN,
      purpose: "readiness",
    });
    expect(getReadyPageData).toHaveBeenCalledWith(expect.anything(), "booking-secret");
    const snapshot = await response.json();
    expect(Object.keys(snapshot).sort()).toEqual([
      "generatedAt",
      "keepUntil",
      "rollback",
      "saved",
      "staleNotice",
      "unverified",
    ]);
    expect(snapshot.saved).toContain("Two-Tank Reef");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("carries no token, id, address of the diver or other booking field in any byte", async () => {
    const text = await (await call()).text();
    for (const secret of [
      TOKEN,
      "booking-secret",
      "shop-1",
      "trip-uuid-secret",
      "person-secret",
      "diver@example.com",
      "Secret Diver",
      "Sam",
      "555-0199",
      "secret rental",
      "987654",
      "/claim/",
      "checkout.stripe.com",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("answers 404 to a dead link without reading any booking", async () => {
    verifyBookingCapability.mockResolvedValue(null);
    const response = await call();
    expect(response.status).toBe(404);
    expect(getReadyPageData).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(TOKEN);
  });

  it.each([
    ["a booking that no longer loads", null],
    ["a cancelled seat", pageData({ detail: { ...pageData().detail, cancelled: true } })],
    ["a departure called off", pageData({ departureCancelled: true })],
    ["a seat the shop released", pageData({ seatReleased: true })],
    ["a held identity", pageData({ identityHeld: true })],
    [
      "a boat already home",
      pageData({
        detail: {
          ...pageData().detail,
          trip: {
            ...pageData().detail.trip,
            startsAt: new Date("2000-01-02T13:00:00Z"),
            endsAt: new Date("2000-01-02T17:00:00Z"),
          },
        },
      }),
    ],
  ])("answers 404, so the phone clears its copy, for %s", async (_case, data) => {
    getReadyPageData.mockResolvedValue(data);
    const response = await call();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("carries the open checklist items, the planned sites and the bring list as named content", async () => {
    const { saved } = await (await call()).json();
    expect(saved).toContain("Add your certification details to your record.");
    expect(saved).toContain("Palancar Reef");
    expect(saved).toContain("Reef-safe sunscreen");
    expect(saved).not.toContain("waiver");
  });

  it("answers 429, not 404, when throttled, before looking the token up", async () => {
    checkRateLimit.mockResolvedValue({ allowed: false });
    const response = await call();
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(verifyBookingCapability).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalledWith("ready-offline:203.0.113.9", expect.anything());
  });
});
