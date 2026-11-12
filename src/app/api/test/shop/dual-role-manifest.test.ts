import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { people, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { seededShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
const { getDb } = await import("@/db/client");
const { POST } = await import("./route");
const secret = "e2e-test-secret";
function request(body: unknown) {
  return new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DIVEDAY_E2E", "1");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
});
afterEach(() => vi.unstubAllEnvs());

it("builds the private cloned shop fact even when the route's generic actor is a passenger", async () => {
  const { db, shop: canonical } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const before = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, canonical.id));
  expect((await POST(request({ facts: ["dualRoleManifest"] }))).status).toBe(404);
  const mint = await POST(
    request({ mint: { slug: "dual-role-actor-private", demo: true }, facts: [] }),
  );
  expect(mint.status).toBe(200);
  const { slug } = await mint.json();
  const shop = await getShopBySlug(db, slug);
  if (!shop) throw new Error("cloned private shop missing");
  const staffIds = new Set((await listStaff(db, shop.id)).map((staff) => staff.person.id));
  const passenger = (await db.select().from(people).where(eq(people.shopId, shop.id))).find(
    (person) => !staffIds.has(person.id),
  );
  if (!passenger) throw new Error("cloned non-staff person missing");
  // The door intentionally picks any same-shop person, ordered by creation.
  // Pin the cloned passenger first instead of relying on tied seed timestamps.
  await db
    .update(people)
    .set({ createdAt: new Date(0) })
    .where(eq(people.id, passenger.id));
  const response = await POST(request({ slug, facts: ["dualRoleManifest"] }));
  expect(response.status).toBe(200);
  const {
    values: { dualRoleManifest: fact },
  } = await response.json();
  expect(fact).toMatchObject({ passengers: 4, crew: 3, physicalTotal: 6 });
  const departure = await getTripManifest(db, shop.id, fact.tripId, "departure");
  expect(departure?.summary.boarded).toBe(4);
  const conflict = await getTripManifest(db, shop.id, fact.tripId, "after_dive_1");
  expect(conflict?.divers.find((row) => row.bookingId === fact.bookingId)?.rollCall?.state).toBe(
    "not_boarded",
  );
  expect(conflict?.crew.find((row) => row.id === fact.personId)?.rollCall?.state).toBe("boarded");
  expect(conflict?.completeness.complete).toBe(false);
  expect(
    await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, canonical.id)),
  ).toEqual(before);
});
