import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { trips } from "@/db/schema";
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
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("@/lib/session");
const { addDepartureAction } = await import("./actions");

const pad = (value: number) => String(value).padStart(2, "0");
const TITLE = "Training day drill";

async function signedInOwner() {
  const { db, shop } = ctx;
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
    isRehearsal: "true",
    ...extra,
  })) {
    form.set(key, value);
  }
  return form;
}

describe("adding a rehearsal from the builder", () => {
  it("puts one private, unpriced rehearsal on the board", async () => {
    const { db, shop } = await signedInOwner();
    expect(
      await redirectedTo(() => addDepartureAction(shop.slug, rehearsalForm(shop.timezone))),
    ).toContain("builder=added");
    const rows = await db
      .select()
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)));
    expect(rows).toEqual([
      expect.objectContaining({
        isRehearsal: true,
        isPrivate: true,
        priceCents: null,
        seriesId: null,
      }),
    ]);
  });

  it("refuses a repeating rehearsal and adds nothing", async () => {
    const { db, shop } = await signedInOwner();
    const form = rehearsalForm(shop.timezone, { repeatIntervalWeeks: "1" });
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=rehearsal-repeats",
    );
    const rows = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, TITLE)));
    expect(rows).toEqual([]);
  });
});
