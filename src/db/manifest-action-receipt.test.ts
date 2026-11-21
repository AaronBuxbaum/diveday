import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { shopClock } from "@/features/day/shop-clock";
import { nowDate } from "@/lib/clock";
import { advanceClock } from "@/test/clock";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest } from "./manifests";
import { rollCallEvents } from "./schema";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/accounts/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));

const { getDb } = await import("./client");
const { requireShopSurface } = await import("@/features/accounts/session");
const { crewRollCallAction, rollCallAction } = await import(
  "@/app/shop/[shopSlug]/trips/[id]/manifest/actions"
);

for (const role of ["diver", "crew"] as const) {
  for (const timing of ["current", "delayed"] as const) {
    it(`returns the exact saved ${timing} receipt for ${role}, without inventing a timestamp on retry`, async () => {
      const { db, shop, reef, booking, staff } = await manifestContext();
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(requireShopSurface).mockResolvedValue({
        shop,
        db,
        clock: shopClock(shop),
        session: {
          user: {
            shopId: shop.id,
            shopSlug: shop.slug,
            personId: staff.id,
            name: staff.fullName,
            email: "staff@demo.invalid",
            roles: ["owner"],
          },
        },
      });
      const crewId = (await getTripManifest(db, shop.id, reef.id))?.crew[0]?.id;
      if (!crewId) throw new Error("fixture crew missing");
      const expectedAt = timing === "delayed" ? new Date(nowDate().getTime() - 60_000) : nowDate();
      const data = new FormData();
      data.set(
        role === "diver" ? "bookingId" : "personId",
        role === "diver" ? booking.booking.id : crewId,
      );
      data.set("status", "not_boarded");
      data.set("clientEventId", crypto.randomUUID());
      data.set("observedEvidenceIds", "[]");
      data.set("meetingDay", "0");
      if (timing === "delayed") data.set("observedAt", expectedAt.toISOString());
      const action = role === "diver" ? rollCallAction : crewRollCallAction;
      const context = { shopSlug: shop.slug, tripId: reef.id, checkpoint: "after_dive_1" as const };
      const first = await action(context, null, data);
      expect(first).toMatchObject({
        ok: true,
        observedAt: expectedAt.toISOString(),
        status: "not_boarded",
        eventId: expect.any(String),
      });
      if (!first?.ok || !first.eventId) throw new Error("expected receipt");
      const [stored] = await db
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.id, first.eventId));
      expect(stored.occurredAt).toEqual(expectedAt);
      advanceClock(60_000);
      const repeated = await action(context, null, data);
      expect(repeated).toMatchObject({ ok: true, eventId: first.eventId, status: "not_boarded" });
      expect(repeated).not.toHaveProperty("observedAt");
      expect(
        await db
          .select()
          .from(rollCallEvents)
          .where(eq(rollCallEvents.clientEventId, data.get("clientEventId") as string)),
      ).toHaveLength(1);
    });
  }
}
