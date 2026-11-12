import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { trips } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const assign = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/db/trips", async (original) => ({
  ...(await original<typeof import("@/db/trips")>()),
  setTripCrew: assign,
}));
vi.mock("../../../../../features/session/rules", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireShopSurface } = await import("../../../../../features/session/rules");
const { addDepartureAction } = await import("./actions");
const ctx = fileScopedShopContext();

it("says the departure exists when assigning its crew times out", async () => {
  const { db, shop } = ctx;
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(requireShopSurface).mockResolvedValue({
    db,
    shop,
    session: staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: owner }),
  } as never);
  assign.mockRejectedValue(Object.assign(new Error("lock wait"), { code: "55P03" }));
  const form = new FormData();
  for (const [key, value] of Object.entries({
    title: "Created before crew wait",
    date: "2035-08-04",
    startTime: "09:00",
    endTime: "13:00",
    capacity: "6",
    plannedDives: "2",
    crewPersonIds: owner,
  }))
    form.set(key, value);
  const landing = await redirectedTo(() => addDepartureAction(shop.slug, form));
  expect(landing).toContain("builder=added-crew-busy");
  const rows = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shop.id), eq(trips.title, "Created before crew wait")));
  expect(rows).toHaveLength(1);
});
