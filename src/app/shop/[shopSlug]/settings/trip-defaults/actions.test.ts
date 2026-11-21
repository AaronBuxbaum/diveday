import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { shops } from "@/db/schema";
import { createTripLens } from "@/features/trips/trip-lenses";
import { fileScopedShopContext } from "@/test/db";
import {
  redirectedTo,
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
  staffSession,
} from "@/test/staff-session";

const ctx = fileScopedShopContext();
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("../../../../../features/accounts/session", () => ({ requireStaffSession: vi.fn() }));
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../../features/accounts/session");
const { saveTripDefaultsAction } = await import("./actions");

async function signIn(email: string) {
  const { db, shop } = ctx;
  vi.mocked(getDb).mockResolvedValue(db);
  const personId = await seededStaffPersonId(db, shop.id, email);
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
  );
  return { db, shop };
}
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    deposit: "50",
    cancellation: "24",
    minimum: "3",
    snorkeler: "0",
    rider: "20",
    lensId: "",
    ...overrides,
  }))
    data.set(key, value);
  return data;
}

it("saves the shop's values, including zero, and refuses invalid or foreign tags", async () => {
  const { db, shop } = await signIn(SEEDED_OWNER_EMAIL);
  expect(await redirectedTo(() => saveTripDefaultsAction(form()))).toContain("notice=saved");
  const [saved] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(saved.tripDefaults).toMatchObject({
    depositCents: 5000,
    snorkelerPriceCents: 0,
    riderPriceCents: 2000,
  });
  const [other] = await db
    .insert(shops)
    .values({ name: "Other", slug: "other-defaults", timezone: "UTC" })
    .returning();
  const tag = await createTripLens(db, other.id, "Other's tag");
  if (!tag) throw new Error("tag missing");
  expect(await redirectedTo(() => saveTripDefaultsAction(form({ lensId: tag.id })))).toContain(
    "notice=invalid",
  );
  expect(await redirectedTo(() => saveTripDefaultsAction(form({ deposit: "-1" })))).toContain(
    "notice=invalid",
  );
  const [after] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(after.tripDefaults).toEqual(saved.tripDefaults);
});

it("refuses a captain even when a form is posted directly", async () => {
  const { db, shop } = await signIn(SEEDED_CAPTAIN_EMAIL);
  expect(await redirectedTo(() => saveTripDefaultsAction(form()))).toContain("not-authorized");
  const [after] = await db.select().from(shops).where(eq(shops.id, shop.id));
  expect(after.tripDefaults).toBeNull();
});
