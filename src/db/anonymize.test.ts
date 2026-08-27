import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { mergeDiverRecords } from "./diver-merge";
import { enqueueOrderIntegrationEvent } from "./integration-events";
import { saveShopIntegration } from "./integrations";
import { integrationEvents, orders, people, personRoles } from "./schema";

async function erasureFixtures() {
  const { db, shop } = await seededShopContext({ history: true });
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return { db, shop, owner };
}

describe("anonymizeDiver — a merged-away record (issue #1014)", () => {
  /**
   * After a merge the source keeps every identifying column, and contact fields
   * only move onto the survivor where the survivor's own was null — so the
   * source's distinct email and phone live on that shell and nowhere else. The
   * shell is unreachable by hand (the diver page redirects a merged id to the
   * survivor before rendering, and that page holds the only erase form), so if
   * erasure does not follow the pointer nothing ever can.
   */
  it("erases the shell a merge left behind", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, survivor] = await db
      .insert(people)
      .values([
        {
          shopId: shop.id,
          fullName: "Adaeze Nwosu",
          email: "adaeze@old.example",
          phone: "+1 (305) 555-0142",
          dateOfBirth: "1990-04-02",
          emergencyContactName: "Ngozi Nwosu",
          emergencyContactPhone: "+1 (305) 555-0143",
        },
        { shopId: shop.id, fullName: "Adaeze Nwosu", email: "adaeze@new.example" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);

    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select()
      .from(people)
      .where(inArray(people.id, [source.id, survivor.id]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.fullName).not.toBe("Adaeze Nwosu");
      expect(row.email).toBeNull();
      expect(row.phone).toBeNull();
      expect(row.dateOfBirth).toBeNull();
      expect(row.emergencyContactName).toBeNull();
      expect(row.emergencyContactPhone).toBeNull();
      expect(row.anonymizedAt).not.toBeNull();
    }
    // The pointer and its stamps survive: what goes is the identity, not the row.
    const shell = rows.find((row) => row.id === source.id);
    expect(shell?.mergedIntoPersonId).toBe(survivor.id);
    expect(shell?.mergedAt).not.toBeNull();
  });
});

describe("anonymizeDiver — the integration outbox (issue #1016)", () => {
  /**
   * `integration_events.payload` is kept 400 days and carries no `person_id`,
   * so a diver's name and email denormalised into it could neither be found nor
   * scrubbed. The fix is that they are never written: the payload names the
   * customer by id, and the name and email are resolved at delivery time. This
   * asserts the property that matters — that an erasure leaves nothing
   * identifying in that table — rather than the implementation that delivers it.
   */
  it("leaves no name or email in an order event's payload", async () => {
    const { db, shop, owner } = await erasureFixtures();
    await saveShopIntegration(db, {
      shopId: shop.id,
      provider: "zapier",
      credentials: { webhookUrl: "https://hooks.zapier.com/hooks/catch/123456/abcdef" },
      settings: { eventTypes: ["order.paid"] },
    });

    const staffIds = await db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .where(inArray(personRoles.role, [...STAFF_ROLES]));
    const staff = new Set(staffIds.map((row) => row.id));
    const orderRows = await db
      .select({ id: orders.id, personId: orders.personId })
      .from(orders)
      .where(eq(orders.shopId, shop.id));
    const order = orderRows.find((row) => !staff.has(row.personId));
    if (!order) throw new Error("expected a seeded order belonging to a diver");
    const [diver] = await db.select().from(people).where(eq(people.id, order.personId)).limit(1);
    if (!diver) throw new Error("expected the order's diver");

    await enqueueOrderIntegrationEvent(db, {
      shopId: shop.id,
      orderId: order.id,
      eventType: "order.paid",
      idempotencyKey: `order:${order.id}:paid`,
    });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const events = await db
      .select()
      .from(integrationEvents)
      .where(eq(integrationEvents.shopId, shop.id));
    expect(events.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(events.map((event) => event.payload));
    expect(serialized).not.toContain(diver.fullName);
    if (diver.email) expect(serialized).not.toContain(diver.email);
    if (diver.phone) expect(serialized).not.toContain(diver.phone);
  });
});
