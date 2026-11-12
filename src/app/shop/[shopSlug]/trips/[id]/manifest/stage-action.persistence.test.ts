import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tripStageEvents } from "@/db/schema";
import { createTrip } from "@/db/trips";
import { latestTripStage } from "@/features/trip-stages";
import { boatStageOf } from "@/lib/trip-phase";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId, staffSession } from "@/test/staff-session";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("../../../../../../features/session/rules", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("../../../../../../features/session/rules");
const { setTripStageAction } = await import("./actions");
const zone = "America/New_York";
const form = (stage: string) => {
  const data = new FormData();
  data.set("stage", stage);
  return data;
};
afterEach(() => vi.unstubAllEnvs());

describe("stage action persistence before and during a departure", () => {
  it.each([
    ["one sailing", "2026-07-23T15:00:00Z", "2026-07-23T19:00:00Z"],
    ["multi-day run", "2026-07-23T15:00:00Z", "2026-07-25T19:00:00Z"],
  ])(
    "records an early tap for a %s, but does not show it on the departure day",
    async (_kind, starts, ends) => {
      const { db, shop } = await seededShopContext();
      const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: "Stage evidence",
        startsAt: new Date(starts),
        endsAt: new Date(ends),
        capacity: 12,
        plannedDives: 2,
      });
      if (!trip) throw new Error("departure was not created");
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(requireStaffSession).mockResolvedValue(
        staffSession({ shopId: shop.id, shopSlug: shop.slug, personId }),
      );
      vi.stubEnv("DIVEDAY_CLOCK", "2026-07-21T13:30:00Z");
      const ctx = { shopSlug: shop.slug, tripId: trip.id };
      expect(await setTripStageAction(ctx, null, form("underway"))).toMatchObject({ ok: true });
      const rows = await db
        .select({ stage: tripStageEvents.stage, recordedAt: tripStageEvents.recordedAt })
        .from(tripStageEvents)
        .where(and(eq(tripStageEvents.shopId, shop.id), eq(tripStageEvents.tripId, trip.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        stage: "underway",
        recordedAt: new Date("2026-07-21T13:30:00Z"),
      });
      const early = await latestTripStage(db, shop.id, trip.id);
      const read = (now: string) =>
        boatStageOf({
          startsAt: new Date(starts),
          endsAt: new Date(ends),
          now: new Date(now),
          timeZone: zone,
          stage: early,
          cancelled: false,
        });
      expect(read("2026-07-21T13:30:00Z")).toBeNull();
      expect(read("2026-07-23T13:30:00Z")).toBeNull();
      vi.stubEnv("DIVEDAY_CLOCK", "2026-07-23T13:30:00Z");
      expect(await setTripStageAction(ctx, null, form("surface"))).toMatchObject({ ok: true });
      const current = await latestTripStage(db, shop.id, trip.id);
      expect(
        boatStageOf({
          startsAt: new Date(starts),
          endsAt: new Date(ends),
          now: new Date("2026-07-23T13:30:00Z"),
          timeZone: zone,
          stage: current,
          cancelled: false,
        })?.stage,
      ).toBe("surface");
      if (_kind === "multi-day run") {
        expect(
          boatStageOf({
            startsAt: new Date(starts),
            endsAt: new Date(ends),
            now: new Date("2026-07-24T13:30:00Z"),
            timeZone: zone,
            stage: current,
            cancelled: false,
          }),
        ).toBeNull();
        vi.stubEnv("DIVEDAY_CLOCK", "2026-07-24T13:30:00Z");
        expect(await setTripStageAction(ctx, null, form("underway"))).toMatchObject({ ok: true });
        const next = await latestTripStage(db, shop.id, trip.id);
        expect(
          boatStageOf({
            startsAt: new Date(starts),
            endsAt: new Date(ends),
            now: new Date("2026-07-24T13:30:00Z"),
            timeZone: zone,
            stage: next,
            cancelled: false,
          })?.stage,
        ).toBe("underway");
      }
    },
  );
});
