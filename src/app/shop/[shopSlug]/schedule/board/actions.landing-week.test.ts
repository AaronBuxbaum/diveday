import { describe, expect, it, vi } from "vitest";
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
 * **The board lands on the new departure's week** ("Try it Saturday", item 5):
 * "Put it on the board" for a date in another week used to land on this one,
 * with the new departure out of view.
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

describe("landing after an add", () => {
  it("opens the board on the week the new departure sails in", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    vi.mocked(requireShopSurface).mockResolvedValue({
      session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
      db,
      shop,
    } as never);
    const day = utcToWallTime(
      new Date(nowDate().getTime() + 17 * 24 * 60 * 60 * 1000),
      shop.timezone,
    );
    const date = `${day.year}-${pad(day.month)}-${pad(day.day)}`;
    const form = new FormData();
    for (const [key, value] of Object.entries({
      title: "Three weeks out",
      date,
      startTime: "09:00",
      endTime: "13:00",
      capacity: "6",
      plannedDives: "2",
    })) {
      form.set(key, value);
    }
    const to = new URL(await redirectedTo(() => addDepartureAction(shop.slug, form)), "http://x");
    expect(to.pathname).toBe(`/shop/${shop.slug}/schedule/board`);
    expect(to.searchParams.get("builder")).toBe("added");
    expect(to.searchParams.get("week")).toBe(date);
  });
});
