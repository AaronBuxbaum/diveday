import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pickup: null as string | null,
  fullPlan: true,
  authorized: true,
}));
const tripId = "11111111-1111-4111-8111-111111111111";
const token = "private-readiness-token";
vi.mock("@/db/client", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/booking-capabilities", () => ({
  verifyBookingCapability: async () =>
    state.authorized ? { tripId, shopId: "shop", bookingId: "private-booking" } : null,
}));
vi.mock("@/db/bookings", () => ({ getBookingPickupTime: async () => state.pickup }));
vi.mock("@/db/shops", () => ({
  getShopBySlug: async () => ({
    id: "shop",
    name: "School",
    timezone: "America/New_York",
    defaultLocale: "en-US",
    dockCallMinutes: 30,
  }),
}));
vi.mock("@/db/trips", () => ({
  getTripWithBooked: async () => ({
    id: tripId,
    status: "scheduled",
    courseId: "course",
    title: "Open Water course",
    startsAt: new Date("2026-11-02T13:00:00Z"),
    endsAt: new Date("2026-11-03T19:00:00Z"),
    course: {
      scheduleDays: [
        { title: "Pool", meetingPlace: "Training pool entrance", items: [] },
        ...(state.fullPlan
          ? [{ title: "Ocean", meetingPlace: "<b>Shop dock</b>", items: [] }]
          : []),
      ],
    },
  }),
  listTripScheduleDays: async () => [
    { startsAt: new Date("2026-11-02T13:00:00Z"), endsAt: new Date("2026-11-02T17:00:00Z") },
    { startsAt: new Date("2026-11-03T14:00:00Z"), endsAt: new Date("2026-11-03T19:00:00Z") },
  ],
}));
vi.mock("@/i18n/request", () => ({ requestLocale: async () => "en-US" }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  RATE_LIMITS: { capabilityAction: {} },
  rateLimitKey: () => "key",
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: async () => "127.0.0.1" }));
const { GET } = await import("./route");
const download = () =>
  GET(new NextRequest(`http://localhost/s/school/trips/${tripId}/arrival-card?booking=${token}`), {
    params: Promise.resolve({ shopSlug: "school", id: tripId }),
  });
beforeEach(() => {
  state.pickup = null;
  state.fullPlan = true;
  state.authorized = true;
});

it("downloads actual course days and authored places without a sailing instruction or credential", async () => {
  const response = await download();
  expect(response.status).toBe(200);
  const html = (await response.text()).replaceAll("\u00a0", " ");
  expect(html).toContain("Your course starts at 8:00 AM");
  expect(html).toContain("Mon, Nov 2 · 8:00 AM – 12:00 PM EST");
  expect(html).toContain("Tue, Nov 3");
  expect(html).toContain("Training pool entrance");
  expect(html).toContain("&lt;b&gt;Shop dock&lt;/b&gt;");
  expect(html).not.toContain("<b>Shop dock</b>");
  expect(html).not.toMatch(/before we sail|at the dock by|private-readiness-token|private-booking/);
});

it("does not map a partial course outline onto actual meetings", async () => {
  state.fullPlan = false;
  const html = await (await download()).text();
  expect(html).toContain("Your course starts at");
  expect(html).not.toContain("Training pool entrance");
});

it("preserves pickup precedence and capability refusal", async () => {
  state.pickup = "07:00";
  const html = await (await download()).text();
  expect(html).not.toMatch(/Your course starts at|before we sail|at the dock by/);
  state.authorized = false;
  expect((await download()).status).toBe(404);
});
