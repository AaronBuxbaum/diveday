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
 * rides a top-level `window.open` from any site; this page refuses that with
 * the same 404 as every other refusal, before it reads the session, the words
 * or writes a `medical_alert_printed` line.
 */
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
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { default: TripPrintWithMedicalAlertsPage } = await import("./page");

const ctx = fileScopedShopContext();

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
  const open = () =>
    TripPrintWithMedicalAlertsPage({
      params: Promise.resolve({ shopSlug: shop.slug, id: departure.id }),
    });
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
