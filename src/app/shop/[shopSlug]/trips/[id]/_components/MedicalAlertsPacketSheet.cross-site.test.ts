import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { activityEvents } from "@/db/schema";
import { DEMO_MEDICAL_ALERT_TRIP } from "@/db/seed-medical-alert";
import { upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { cookieJar } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

/**
 * **A cross-site navigation never prints the words or writes the trail**
 * (security review of #2990, M1). The session cookie is SameSite=Lax, so it
 * rides a top-level `window.open` from any site; this print state
 * (`?print=medical-alerts`, #2736) refuses that with
 * the same 404 as every other refusal, before it reads the session, the words
 * or writes a `medical_alert_printed` line.
 */
const ctx = fileScopedShopContext();
const request = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => {
  const jar = cookieJar();
  return { headers: async () => request.headers, cookies: async () => jar };
});
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// The packet compares the shop it was handed with the shop's identity rows, so
// this surface needs the whole shop row, not the id and slug the shared mock hands back.
vi.mock("@/lib/session", async () => {
  const base = await (await import("@/test/staff-session")).sessionMockOverStaffSession();
  const requireShopSurface = vi.fn(async (shopSlug: string) => ({
    ...(await base.requireShopSurface(shopSlug)),
    shop: ctx.shop,
  }));
  return { ...base, requireShopSurface };
});
vi.mock("@/db/trip-paper-identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/trip-paper-identity")>();
  return { ...actual, readTripPaperIdentity: vi.fn(actual.readTripPaperIdentity) };
});
vi.mock("@/db/trip-overview", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/trip-overview")>();
  return { ...actual, getTripOverview: vi.fn(actual.getTripOverview) };
});
const { getDb } = await import("@/db/client");
const { readTripPaperIdentity } = await import("@/db/trip-paper-identity");
const { getTripOverview } = await import("@/db/trip-overview");
const { requireStaffSession } = await import("@/lib/session");
const { MedicalAlertsPacketSheet } = await import("./MedicalAlertsPacketSheet");

async function ownerOnTheAlertDeparture() {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const departure = trips.find((trip) => trip.title === DEMO_MEDICAL_ALERT_TRIP);
  if (!departure) throw new Error("seeded alert departure missing");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  );
  const printedLines = () =>
    db
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(
        and(eq(activityEvents.shopId, shop.id), eq(activityEvents.code, "medical_alert_printed")),
      );
  const open = () => MedicalAlertsPacketSheet({ shopSlug: shop.slug, tripId: departure.id });
  return { printedLines, open, host: "app.diveday.test" };
}

describe("the print with medical alerts, opened from another site", () => {
  it("is a 404 for a cross-site navigation, and records nothing", async () => {
    const { printedLines, open, host } = await ownerOnTheAlertDeparture();
    const before = (await printedLines()).length;
    const navigations: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", host },
      { "sec-fetch-site": "same-site", host, referer: "https://blog.diveday.test/" },
      { host, referer: "https://evil.example/" },
    ];
    for (const headers of navigations) {
      request.headers = new Headers(headers);
      vi.mocked(requireStaffSession).mockClear();
      await expect(open()).rejects.toThrow("NOT_FOUND");
      // Refused before the session was even read.
      expect(requireStaffSession).not.toHaveBeenCalled();
    }
    expect(await printedLines()).toHaveLength(before);
  });

  it("prints for the app's own navigation and records it", async () => {
    const { printedLines, open, host } = await ownerOnTheAlertDeparture();
    const before = (await printedLines()).length;
    request.headers = new Headers({ "sec-fetch-site": "same-origin", host });
    await expect(open()).resolves.toBeTruthy();
    expect((await printedLines()).length).toBeGreaterThan(before);
  });
});

/**
 * **The trail matches what printed** (issue #3727). The words are read first,
 * but a line is written only for a packet that will come out: a departure that
 * vanished mid-print is the 404, and one that changed under the readers
 * answers its "changed" sheet, which carries no words. Neither leaves a
 * "printed medical alerts" line for a copy that never existed.
 */
describe("the print with medical alerts, when the packet cannot print", () => {
  it("is a 404 and records nothing when the departure vanishes after the words are read", async () => {
    const { printedLines, open, host } = await ownerOnTheAlertDeparture();
    const before = (await printedLines()).length;
    request.headers = new Headers({ "sec-fetch-site": "same-origin", host });
    vi.mocked(readTripPaperIdentity).mockResolvedValueOnce(null as never);
    await expect(open()).rejects.toThrow("NOT_FOUND");
    expect(await printedLines()).toHaveLength(before);
  });

  it("answers the changed sheet and records nothing when a reader finds the departure gone", async () => {
    const { printedLines, open, host } = await ownerOnTheAlertDeparture();
    const before = (await printedLines()).length;
    request.headers = new Headers({ "sec-fetch-site": "same-origin", host });
    vi.mocked(getTripOverview).mockResolvedValueOnce(null);
    await expect(open()).resolves.toBeTruthy();
    expect(await printedLines()).toHaveLength(before);
  });
});
