import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { shops, trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();

/**
 * **A rehearsal is added from the builder** (ADR 20261012-rehearsal-departures):
 * the same add flow as any departure, one box ticked, and what comes out is
 * private and unpriced whatever else the form said. A rehearsal is one
 * departure, so asking for it to repeat is refused with its own sentence.
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
vi.mock("../../../../../features/accounts/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/accounts/session");
const { addDepartureAction } = await import("./actions");

const pad = (value: number) => String(value).padStart(2, "0");
const TITLE = "Training day drill";

async function signedInOwner() {
  const { db, shop: original } = ctx;
  const [shop] = await db
    .update(shops)
    .set({
      tripDefaults: {
        depositCents: 5000,
        cancellationWindowHours: 24,
        minimumBookings: 3,
        snorkelerPriceCents: 0,
        riderPriceCents: 2000,
        lensId: null,
      },
    })
    .where(eq(shops.id, original.id))
    .returning();
  vi.mocked(getDb).mockResolvedValue(db);
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(requireShopSurface).mockResolvedValue({
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
    db,
    shop,
  } as never);
  return { db, shop };
}

function rehearsalForm(timeZone: string, extra: Record<string, string> = {}) {
  const day = utcToWallTime(new Date(nowDate().getTime() + 10 * 24 * 60 * 60 * 1000), timeZone);
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title: TITLE,
    date: `${day.year}-${pad(day.month)}-${pad(day.day)}`,
    startTime: "09:00",
    endTime: "13:00",
    capacity: "6",
    plannedDives: "2",
    priceDollars: "120",
    ...extra,
  })) {
    form.set(key, value);
  }
  return form;
}

describe("shop defaults on new departures", () => {
  it("copies defaults when the terms panel was not opened", async () => {
    const { db, shop } = await signedInOwner();
    expect(
      await redirectedTo(() => addDepartureAction(shop.slug, rehearsalForm(shop.timezone))),
    ).toContain("builder=added");
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)));
    expect(trip).toMatchObject({
      depositCents: 5000,
      cancellationWindowHours: 24,
      minimumBookings: 3,
      snorkelerPriceCents: 0,
      riderPriceCents: 2000,
      shopDefaultFields: [
        "depositCents",
        "cancellationWindowHours",
        "minimumBookings",
        "snorkelerPriceCents",
        "riderPriceCents",
      ],
    });
  });
  it("keeps an explicit changed value and clears its provenance", async () => {
    const { db, shop } = await signedInOwner();
    const form = rehearsalForm(shop.timezone, {
      depositDollars: "0",
      cancellationWindowHours: "",
      minimumBookings: "3",
    });
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=added",
    );
    const [trip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)));
    expect(trip).toMatchObject({
      depositCents: 0,
      cancellationWindowHours: null,
      minimumBookings: 3,
    });
    expect(trip.shopDefaultFields).toEqual([
      "minimumBookings",
      "snorkelerPriceCents",
      "riderPriceCents",
    ]);
  });
});
