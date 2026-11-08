import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { trips } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { addCalendarDays, utcToWallTime } from "@/lib/zoned";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";
import { addInterest } from "../../../../../test/substrate-fixtures/db/interest-dates-fixtures";

const ctx = fileScopedShopContext();

/**
 * **A departure built from a charter request is private** (loop 5, row 11):
 * the boat is the group's, so it never goes on the public schedule, whatever
 * the Private box said. An ordinary request leaves the box in charge.
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
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/session/rules");
const { addDepartureAction } = await import("./actions");

const pad = (value: number) => String(value).padStart(2, "0");

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

function departureForm(timeZone: string, title: string, interestId: string) {
  const first = utcToWallTime(new Date(nowDate().getTime() + 10 * 24 * 60 * 60 * 1000), timeZone);
  const day = addCalendarDays(first, 0);
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title,
    date: `${day.year}-${pad(day.month)}-${pad(day.day)}`,
    startTime: "08:00",
    endTime: "12:00",
    capacity: "6",
    plannedDives: "2",
    priceDollars: "150",
  })) {
    form.set(key, value);
  }
  form.append("interestId", interestId);
  return form;
}

async function privacyOf(db: typeof ctx.db, shopId: string, title: string) {
  const [row] = await db
    .select({ isPrivate: trips.isPrivate })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, title)));
  return row?.isPrivate;
}

describe("building a departure from a request", () => {
  it("makes it private when the request asked for the whole boat", async () => {
    const { db, shop } = await signedInOwner();
    const id = await addInterest(db, shop.id, { interest: "Our own boat", charter: true });
    const form = departureForm(shop.timezone, "Sharma family charter", id);
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=added",
    );
    expect(await privacyOf(db, shop.id, "Sharma family charter")).toBe(true);
  });

  it("leaves an ordinary request's departure as the box said", async () => {
    const { db, shop } = await signedInOwner();
    const id = await addInterest(db, shop.id, { interest: "Two-tank reef" });
    const form = departureForm(shop.timezone, "Saturday reef", id);
    expect(await redirectedTo(() => addDepartureAction(shop.slug, form))).toContain(
      "builder=added",
    );
    expect(await privacyOf(db, shop.id, "Saturday reef")).toBe(false);
  });
});
