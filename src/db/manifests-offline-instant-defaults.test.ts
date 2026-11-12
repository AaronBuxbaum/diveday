import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { rollCallEvents } from "./schema";

describe("roll-call recorder timestamp defaults", () => {
  for (const subject of ["diver", "crew"] as const) {
    for (const source of ["live", "offline"] as const) {
      it(`${subject}: records the missing-diver mark with ${source === "live" ? "its explicit live instant" : "server time when no device instant was supplied"}`, async () => {
        const { db, shop, reef, booking, staff } = await manifestContext();
        const now = nowDate();
        const expected = source === "live" ? new Date(now.getTime() - 60_000) : now;
        const common = {
          shopId: shop.id,
          tripId: reef.id,
          recordedByPersonId: staff.id,
          checkpoint: "after_dive_1" as const,
          status: "not_boarded" as const,
          source,
          ...(source === "live"
            ? { occurredAt: expected }
            : {
                clientEventId: crypto.randomUUID(),
                offlineSnapshotSavedAt: new Date(now.getTime() - 300_000),
              }),
        };
        const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
        if (!crewId) throw new Error("seeded crew missing");
        const outcome =
          subject === "diver"
            ? await recordRollCall(db, { ...common, bookingId: booking.booking.id })
            : await recordCrewRollCall(db, { ...common, personId: crewId });
        expect(outcome).toMatchObject({ ok: true });
        if (!outcome.ok) throw new Error("roll-call write refused");
        const [stored] = await db
          .select()
          .from(rollCallEvents)
          .where(eq(rollCallEvents.id, outcome.eventId));
        expect(stored).toMatchObject({ status: "not_boarded", source, occurredAt: expected });
        const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
        const standing =
          subject === "diver"
            ? manifest?.divers.find((row) => row.bookingId === booking.booking.id)?.rollCall
            : manifest?.crew.find((row) => row.id === crewId)?.rollCall;
        expect(standing).toMatchObject({ state: "not_boarded", occurredAt: expected });
      });
    }
  }
});
