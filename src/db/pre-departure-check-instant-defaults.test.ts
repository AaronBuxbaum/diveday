import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import {
  createChecklistItem,
  latestPreDepartureChecksForTrip,
  recordPreDepartureCheck,
} from "./pre-departure-check";
import { preDepartureCheckEvents } from "./schema";

describe("checklist recorder timestamp defaults", () => {
  for (const source of ["live", "offline"] as const) {
    it(`keeps the oxygen check's ${source === "live" ? "explicit live time" : "server-time fallback"}`, async () => {
      const { db, shop, reef } = await manifestContext();
      const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
      const created = await createChecklistItem(db, {
        shopId: shop.id,
        personId: owner,
        label: "Clock regression: oxygen aboard",
      });
      if (!created.ok) throw new Error("checklist setup refused");
      const now = nowDate();
      const expected = source === "live" ? new Date(now.getTime() - 60_000) : now;
      const result = await recordPreDepartureCheck(db, {
        shopId: shop.id,
        tripId: reef.id,
        checklistItemId: created.id,
        recordedByPersonId: owner,
        status: "checked",
        source,
        ...(source === "live"
          ? { occurredAt: expected }
          : {
              clientEventId: crypto.randomUUID(),
              offlineSnapshotSavedAt: new Date(now.getTime() - 300_000),
            }),
      });
      expect(result).toMatchObject({ ok: true });
      if (!result.ok) throw new Error("checklist write refused");
      const [stored] = await db
        .select()
        .from(preDepartureCheckEvents)
        .where(eq(preDepartureCheckEvents.id, result.eventId));
      expect(stored).toMatchObject({ status: "checked", source, occurredAt: expected });
      const checks = await latestPreDepartureChecksForTrip(db, shop.id, reef.id);
      expect(checks.get(created.id)).toMatchObject({ occurredAt: expected });
    });
  }
});
