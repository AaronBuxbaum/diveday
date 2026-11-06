import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createBoat } from "@/db/boats";
import { boats, trips } from "@/db/schema";
import { createTrip } from "@/db/trips";
import { wallTimeToUtc } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **A section save asks the yard about the days the departure really holds**
 * (issue #4026). Only the timing section posts the meeting days; every other
 * section used to rebuild a consecutive run from day one, so the yard was
 * asked about days the departure never sails. A course meets Saturday
 * 2031-01-11 and Saturday 2031-01-18; the Sunday between is not held.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { saveDetailsSection } = await import("./details-actions");

async function hullInTheYard(name: string, from: string, until: string) {
  const { db, shop } = ctx;
  const boat = await createBoat(db, shop.id, name, 12);
  await db
    .update(boats)
    .set({ outOfServiceFrom: from, outOfServiceUntil: until, outOfServiceReason: "Survey" })
    .where(eq(boats.id, boat.id));
  return boat;
}

async function twoSaturdaysOn(boatId: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  } as never);
  const at = (day: number, hour: number) =>
    wallTimeToUtc({ year: 2031, month: 1, day, hour, minute: 0 }, shop.timezone);
  const course = await createTrip(db, {
    shopId: shop.id,
    title: "Two Saturdays",
    startsAt: at(11, 8),
    endsAt: at(18, 16),
    capacity: 6,
    diveMode: "boat",
    boatId,
    scheduleDays: [
      { dayNumber: 1, startsAt: at(11, 8), endsAt: at(11, 16) },
      { dayNumber: 2, startsAt: at(18, 9), endsAt: at(18, 15) },
    ],
  });
  if (!course) throw new Error("course missing");
  return { db, shop, course };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("a section save on a course that meets on two Saturdays", () => {
  it("saves its meeting point when the yard holds only the Sunday between", async () => {
    const hullA = await hullInTheYard("Hull A", "2031-01-12", "2031-01-12");
    const { db, shop, course } = await twoSaturdaysOn(hullA.id);
    const to = await redirectedTo(() =>
      saveDetailsSection(
        shop.slug,
        course.id,
        "meeting",
        form({ meetingPointLabel: "North pier", meetingPointAddress: "" }),
      ),
    );
    expect(to).toContain("notice=saved");
    const [saved] = await db
      .select({ label: trips.meetingPointLabel })
      .from(trips)
      .where(eq(trips.id, course.id));
    expect(saved?.label).toBe("North pier");
  });

  it("saves its boat section when the yard holds only the Sunday between", async () => {
    const hullA = await hullInTheYard("Hull A", "2031-01-12", "2031-01-12");
    const { shop, course } = await twoSaturdaysOn(hullA.id);
    const to = await redirectedTo(() =>
      saveDetailsSection(
        shop.slug,
        course.id,
        "boat",
        form({ diveMode: "boat", boatId: hullA.id }),
      ),
    );
    expect(to).toContain("notice=saved");
  });

  // Experience first: a meeting-point fix moves neither the days nor the hull,
  // so a hull that went to the yard after the booking does not block it.
  it("saves a meeting point on a departure whose hull went to the yard later", async () => {
    const hullA = await hullInTheYard("Hull A", "2031-01-18", "2031-01-18");
    const { shop, course } = await twoSaturdaysOn(hullA.id);
    const to = await redirectedTo(() =>
      saveDetailsSection(
        shop.slug,
        course.id,
        "meeting",
        form({ meetingPointLabel: "North pier", meetingPointAddress: "" }),
      ),
    );
    expect(to).toContain("notice=saved");
  });

  it("refuses a hull swap to a boat in the yard on the second Saturday, naming that day", async () => {
    const hullA = await hullInTheYard("Hull A", "2031-02-01", "2031-02-02");
    const hullB = await hullInTheYard("Hull B", "2031-01-18", "2031-01-18");
    const { db, shop, course } = await twoSaturdaysOn(hullA.id);
    const to = await redirectedTo(() =>
      saveDetailsSection(
        shop.slug,
        course.id,
        "boat",
        form({ diveMode: "boat", boatId: hullB.id }),
      ),
    );
    expect(to).toContain("notice=boat-out-of-service");
    expect(to).toContain("on=2031-01-18");
    const [kept] = await db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(eq(trips.id, course.id));
    expect(kept?.boatId).toBe(hullA.id);
  });
});
