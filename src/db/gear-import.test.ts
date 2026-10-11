import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { prepareGearImport } from "@/lib/gear-import";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { commitGearImport } from "./gear-import";
import { gearItems, gearServiceEvents, people, priorGearAssignments, shops } from "./schema";

const ctx = fileScopedShopContext();

async function staffAndDiver(db: AppDb, shopId: string) {
  const rows = await db
    .select({ id: people.id, email: people.email, fullName: people.fullName })
    .from(people)
    .where(and(eq(people.shopId, shopId), isNotNull(people.email)))
    .limit(2);
  const [staff, diver] = rows;
  if (!staff || !diver?.email) throw new Error("seeded people missing");
  return { staffId: staff.id, diver: { ...diver, email: diver.email } };
}

async function otherShop(db: AppDb) {
  const [other] = await db
    .insert(shops)
    .values({ name: "Other Reef", slug: "other-reef-gear-import", timezone: "America/New_York" })
    .returning();
  if (!other) throw new Error("other shop insert failed");
  return other;
}

const HEADER =
  "gear_label,gear_kind,gear_size,serial_number,service_kind,serviced_on,next_due_on,service_note";

describe("commitGearImport", () => {
  it("creates the units and their service history, and a second run of the same file changes nothing", async () => {
    const { db, shop } = ctx;
    const { staffId } = await staffAndDiver(db, shop.id);
    const prepared = prepareGearImport(
      [
        HEADER,
        "IMP-REG-1,regulator,,SN-IMP-1,annual service,2026-03-01,2027-03-01,rebuilt",
        "IMP-BCD-1,bcd,M,,,,,",
      ].join("\n"),
    );

    const first = await commitGearImport(db, shop.id, prepared, staffId);
    expect(first).toMatchObject({
      unitsCreated: 2,
      unitsMatched: 0,
      eventsAdded: 1,
      rowsSkipped: 0,
    });

    const again = await commitGearImport(db, shop.id, prepared, staffId);
    expect(again).toMatchObject({
      unitsCreated: 0,
      unitsMatched: 2,
      eventsAdded: 0,
      eventsSkipped: 1,
    });

    const units = await db
      .select()
      .from(gearItems)
      .where(and(eq(gearItems.shopId, shop.id), eq(gearItems.serialNumber, "SN-IMP-1")));
    expect(units).toHaveLength(1);
    const events = await db
      .select()
      .from(gearServiceEvents)
      .where(eq(gearServiceEvents.gearItemId, units[0]?.id ?? ""));
    expect(events).toEqual([
      expect.objectContaining({ shopId: shop.id, recordedByPersonId: staffId, note: "rebuilt" }),
    ]);
  });

  it("matches by serial when the tag changed, and a blank cell never erases what the unit has", async () => {
    const { db, shop } = ctx;
    const { staffId } = await staffAndDiver(db, shop.id);
    await commitGearImport(
      db,
      shop.id,
      prepareGearImport(`${HEADER}\nIMP-OLD-TAG,wetsuit,L,SN-RETAG,,,,`),
      staffId,
    );
    const outcome = await commitGearImport(
      db,
      shop.id,
      prepareGearImport(`${HEADER}\nIMP-NEW-TAG,wetsuit,,SN-RETAG,,,,`),
      staffId,
    );
    expect(outcome).toMatchObject({ unitsCreated: 0, unitsMatched: 1 });
    const [unit] = await db
      .select()
      .from(gearItems)
      .where(and(eq(gearItems.shopId, shop.id), eq(gearItems.serialNumber, "SN-RETAG")));
    // The tag is the shop's own; an import that found the unit by serial
    // keeps it and keeps the size the file left blank.
    expect(unit).toMatchObject({ label: "IMP-OLD-TAG", size: "L" });
  });

  it("never matches or edits another shop's unit with the same tag or serial", async () => {
    const { db, shop } = ctx;
    const { staffId } = await staffAndDiver(db, shop.id);
    const other = await otherShop(db);
    const [theirs] = await db
      .insert(gearItems)
      .values({
        shopId: other.id,
        kind: "bcd",
        label: "IMP-SHARED",
        size: "S",
        serialNumber: "SN-SHARED",
      })
      .returning();
    if (!theirs) throw new Error("other unit insert failed");

    const outcome = await commitGearImport(
      db,
      shop.id,
      prepareGearImport(`${HEADER}\nIMP-SHARED,regulator,XL,SN-SHARED,service,2026-03-01,,`),
      staffId,
    );
    expect(outcome).toMatchObject({ unitsCreated: 1, unitsMatched: 0, eventsAdded: 1 });
    const [after] = await db.select().from(gearItems).where(eq(gearItems.id, theirs.id));
    expect(after).toMatchObject({ kind: "bcd", size: "S", updatedAt: theirs.updatedAt });
    expect(
      await db.select().from(gearServiceEvents).where(eq(gearServiceEvents.gearItemId, theirs.id)),
    ).toEqual([]);
  });

  it("never revives or edits a deleted unit; a row with its tag is a new unit", async () => {
    const { db, shop } = ctx;
    const { staffId } = await staffAndDiver(db, shop.id);
    const [retired] = await db
      .insert(gearItems)
      .values({
        shopId: shop.id,
        kind: "tank",
        label: "IMP-RETIRED",
        serialNumber: "SN-RETIRED",
        deletedAt: nowDate(),
      })
      .returning();
    if (!retired) throw new Error("retired unit insert failed");
    const outcome = await commitGearImport(
      db,
      shop.id,
      prepareGearImport(`${HEADER}\nIMP-RETIRED,tank,,SN-RETIRED,,,,`),
      staffId,
    );
    expect(outcome).toMatchObject({ unitsCreated: 1, unitsMatched: 0 });
    const [after] = await db.select().from(gearItems).where(eq(gearItems.id, retired.id));
    expect(after?.deletedAt).not.toBeNull();
  });

  it("writes nothing for a row with an issue, and counts it skipped", async () => {
    const { db, shop } = ctx;
    const { staffId } = await staffAndDiver(db, shop.id);
    const outcome = await commitGearImport(
      db,
      shop.id,
      prepareGearImport(
        [HEADER, "IMP-BAD-DATE,bcd,,,service,2026-13-45,,", ",bcd,M,,,,,"].join("\n"),
      ),
      staffId,
    );
    expect(outcome).toMatchObject({ unitsCreated: 0, eventsAdded: 0, rowsSkipped: 2 });
    expect(
      await db
        .select()
        .from(gearItems)
        .where(and(eq(gearItems.shopId, shop.id), eq(gearItems.label, "IMP-BAD-DATE"))),
    ).toEqual([]);
  });

  describe("prior assignments", () => {
    const ASSIGNMENT_HEADER =
      "gear_label,gear_kind,person_email,assigned_from,assigned_until,assignment_status,assignment_reference";

    it("records a past rental once, however many times the file is imported", async () => {
      const { db, shop } = ctx;
      const { staffId, diver } = await staffAndDiver(db, shop.id);
      const prepared = prepareGearImport(
        `${ASSIGNMENT_HEADER}\nIMP-RENTED,bcd,${diver.email.toUpperCase()},2026-06-01,2026-06-05,returned,R-1`,
      );
      expect(await commitGearImport(db, shop.id, prepared, staffId)).toMatchObject({
        assignmentsAdded: 1,
        assignmentsUnmatched: 0,
      });
      expect(await commitGearImport(db, shop.id, prepared, staffId)).toMatchObject({
        assignmentsAdded: 0,
        assignmentsSkipped: 1,
      });
      const rows = await db
        .select()
        .from(priorGearAssignments)
        .where(eq(priorGearAssignments.shopId, shop.id));
      expect(rows).toEqual([
        expect.objectContaining({ personId: diver.id, sourceReference: "R-1", dedupeKey: "R-1" }),
      ]);
    });

    it("never attaches a rental to another shop's diver, by email or by name", async () => {
      const { db, shop } = ctx;
      const { staffId } = await staffAndDiver(db, shop.id);
      const other = await otherShop(db);
      await db.insert(people).values({
        shopId: other.id,
        fullName: "Nadia Neighbour",
        email: "nadia.neighbour@example.com",
      });
      const byEmail = prepareGearImport(
        `${ASSIGNMENT_HEADER}\nIMP-CROSS-1,bcd,nadia.neighbour@example.com,2026-06-01,2026-06-05,returned,X-1`,
      );
      const byName = prepareGearImport(
        "gear_label,gear_kind,person_name,assigned_from,assigned_until\nIMP-CROSS-2,bcd,Nadia Neighbour,2026-06-01,2026-06-05",
      );
      for (const prepared of [byEmail, byName]) {
        expect(await commitGearImport(db, shop.id, prepared, staffId)).toMatchObject({
          unitsCreated: 1,
          assignmentsAdded: 0,
          assignmentsUnmatched: 1,
        });
      }
      expect(await db.select().from(priorGearAssignments)).toEqual([]);
    });

    it("imports the unit but not a rental whose dates are wrong", async () => {
      const { db, shop } = ctx;
      const { staffId, diver } = await staffAndDiver(db, shop.id);
      const outcome = await commitGearImport(
        db,
        shop.id,
        prepareGearImport(
          `${ASSIGNMENT_HEADER}\nIMP-BACKWARDS,bcd,${diver.email},2026-06-05,2026-06-01,returned,`,
        ),
        staffId,
      );
      expect(outcome).toMatchObject({
        unitsCreated: 1,
        assignmentsAdded: 0,
        assignmentsUnmatched: 1,
      });
      expect(await db.select().from(priorGearAssignments)).toEqual([]);
    });
  });
});
