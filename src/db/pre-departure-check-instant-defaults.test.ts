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
  it("refuses an invalid snapshot and an older offline check without replacing a live check", async () => {
    const { db, shop, reef } = await manifestContext();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const item = await createChecklistItem(db, {
      shopId: shop.id,
      personId: owner,
      label: "Clock regression: first aid aboard",
    });
    if (!item.ok) throw new Error("checklist setup refused");
    const now = nowDate();
    const common = {
      shopId: shop.id,
      tripId: reef.id,
      checklistItemId: item.id,
      recordedByPersonId: owner,
      status: "checked" as const,
    };
    await expect(recordPreDepartureCheck(db, common)).resolves.toMatchObject({ ok: true });
    const old = new Date(now.getTime() - 60_000);
    const offline = {
      ...common,
      source: "offline" as const,
      clientEventId: crypto.randomUUID(),
      occurredAt: old,
    };
    await expect(recordPreDepartureCheck(db, offline)).resolves.toEqual({
      ok: false,
      reason: "snapshot_invalid",
    });
    await expect(
      recordPreDepartureCheck(db, {
        ...offline,
        offlineSnapshotSavedAt: new Date(old.getTime() - 60_000),
      }),
    ).resolves.toEqual({ ok: false, reason: "newer_event_exists" });
    const checks = await latestPreDepartureChecksForTrip(db, shop.id, reef.id);
    expect(checks.get(item.id)).toMatchObject({ state: "checked", occurredAt: now });
  });

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
