import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { loadShopExportBundleInput } from "../../db/export";
import { table } from "../../db/export-bundle-table.test-support";
import {
  people,
  personRoles,
  shops,
  tripConservation,
  trips,
  userAccounts,
} from "../../db/schema/index";
import { createTrip } from "../../db/trips";
import { DAY_MS, nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import {
  getTripConservationPanel,
  recordTripConservation,
  tripConservationFacts,
} from "./trip-conservation.store";

const ctx = fileScopedShopContext();
const fact = {
  kind: "litter_kg",
  quantity: 1.8,
  location: "Palancar Reef",
  note: "Discarded fishing gear",
};
async function fixture() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const now = nowDate();
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Cleanup departure",
    startsAt: new Date(now.getTime() - 2 * DAY_MS),
    endsAt: new Date(now.getTime() - DAY_MS),
    plannedDives: 1,
    capacity: 4,
  });
  if (!trip || !owner) throw new Error("conservation fixture needs a departure and owner");
  const input = {
    shopId: shop.id,
    tripId: trip.id,
    personId: owner.id,
    operation: "record" as const,
    fact,
    now,
  };
  return { db, shop, owner, trip, input };
}

describe("trip conservation records", () => {
  it("records multiple measured facts, corrects with a revision, and soft-deletes without publishing deleted facts", async () => {
    const { db, shop, trip, input } = await fixture();
    expect(await recordTripConservation(db, input)).toEqual({ ok: true });
    expect(
      await recordTripConservation(db, {
        ...input,
        fact: { ...fact, kind: "line_m", quantity: 12 },
      }),
    ).toEqual({ ok: true });
    const panel = await getTripConservationPanel(db, shop.id, trip.id, input.personId);
    expect(panel?.editable).toBe(true);
    expect(panel?.rows).toHaveLength(2);
    const row = panel?.rows.find((r) => r.kind === "litter_kg");
    if (!row) throw new Error("expected conservation fact");
    expect(
      await recordTripConservation(db, {
        ...input,
        id: row.id,
        revision: row.revision,
        fact: { ...fact, quantity: 2.4 },
      }),
    ).toEqual({ ok: true });
    expect(
      await recordTripConservation(db, { ...input, id: row.id, revision: row.revision, fact }),
    ).toEqual({ ok: false, reason: "stale" });
    expect(await tripConservationFacts(db, shop.id, trip.id)).toContainEqual({
      id: row.id,
      ...fact,
      quantity: 2.4,
    });
    expect(
      await recordTripConservation(db, { ...input, id: row.id, revision: 2, operation: "delete" }),
    ).toEqual({ ok: true });
    const publicFacts = await tripConservationFacts(db, shop.id, trip.id);
    expect(publicFacts).toHaveLength(1);
    expect(publicFacts[0]).not.toHaveProperty("recordedByPersonId");
    const [deleted] = await db
      .select()
      .from(tripConservation)
      .where(eq(tripConservation.id, row.id));
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("switching off closes read and write doors without deleting stored actions", async () => {
    const { db, shop, trip, input } = await fixture();
    await recordTripConservation(db, input);
    await db.update(shops).set({ conservationEnabled: false }).where(eq(shops.id, shop.id));
    expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([]);
    expect(await getTripConservationPanel(db, shop.id, trip.id, input.personId)).toBeNull();
    expect(await recordTripConservation(db, input)).toEqual({ ok: false, reason: "unavailable" });
    await db.update(shops).set({ conservationEnabled: true }).where(eq(shops.id, shop.id));
    expect(await tripConservationFacts(db, shop.id, trip.id)).toHaveLength(1);
  });

  it("refuses unmeasured, cross-tenant, disabled-staff, future, cancelled and deleted writes", async () => {
    const { db, shop, owner, trip, input } = await fixture();
    expect(await recordTripConservation(db, { ...input, fact: { ...fact, quantity: 0 } })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await recordTripConservation(db, { ...input, shopId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await recordTripConservation(db, { ...input, tripId: crypto.randomUUID() })).toEqual({
      ok: false,
      reason: "unavailable",
    });
    await db
      .update(userAccounts)
      .set({ status: "disabled" })
      .where(eq(userAccounts.personId, owner.id));
    expect(await recordTripConservation(db, input)).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    await db
      .update(userAccounts)
      .set({ status: "active" })
      .where(eq(userAccounts.personId, owner.id));
    await db
      .update(trips)
      .set({ endsAt: new Date(input.now.getTime() + DAY_MS) })
      .where(eq(trips.id, trip.id));
    expect(await recordTripConservation(db, input)).toEqual({ ok: false, reason: "not_returned" });
    await db
      .update(trips)
      .set({ endsAt: trip.endsAt, status: "cancelled" })
      .where(eq(trips.id, trip.id));
    expect(await recordTripConservation(db, input)).toEqual({ ok: false, reason: "unavailable" });
    await db
      .update(trips)
      .set({ status: "scheduled", deletedAt: input.now })
      .where(eq(trips.id, trip.id));
    expect(await recordTripConservation(db, input)).toEqual({ ok: false, reason: "unavailable" });
    expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([]);
  });

  it("does not publish rehearsal facts or let another trip edit a record", async () => {
    const { db, shop, trip, input } = await fixture();
    await recordTripConservation(db, input);
    const panel = await getTripConservationPanel(db, shop.id, trip.id, input.personId);
    const row = panel?.rows[0];
    if (!row) throw new Error("expected conservation fact");
    const other = await createTrip(db, {
      shopId: shop.id,
      title: "Other",
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      plannedDives: 1,
      capacity: 4,
    });
    expect(
      await recordTripConservation(db, {
        ...input,
        tripId: other?.id ?? "",
        id: row.id,
        revision: row.revision,
      }),
    ).toEqual({ ok: false, reason: "stale" });
    await db.update(trips).set({ isRehearsal: true, isPrivate: true }).where(eq(trips.id, trip.id));
    expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([]);
  });
});

it("undo restores only the exact deleted revision and rechecks the feature switch", async () => {
  const { db, shop, trip, input } = await fixture();
  await recordTripConservation(db, input);
  const panel = await getTripConservationPanel(db, shop.id, trip.id, input.personId);
  const row = panel?.rows[0];
  if (!row) throw new Error("Expected recorded conservation fact");
  await recordTripConservation(db, {
    ...input,
    operation: "delete",
    id: row.id,
    revision: row.revision,
  });
  const restore = {
    ...input,
    operation: "restore" as const,
    id: row.id,
    revision: row.revision + 1,
  };
  expect(await recordTripConservation(db, { ...restore, revision: row.revision })).toEqual({
    ok: false,
    reason: "stale",
  });
  await db.update(shops).set({ conservationEnabled: false }).where(eq(shops.id, shop.id));
  expect(await recordTripConservation(db, restore)).toEqual({ ok: false, reason: "unavailable" });
  await db.update(shops).set({ conservationEnabled: true }).where(eq(shops.id, shop.id));
  expect(await recordTripConservation(db, restore)).toEqual({ ok: true });
  expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([{ id: row.id, ...fact }]);
  expect(await recordTripConservation(db, restore)).toEqual({ ok: false, reason: "stale" });
});

it("keeps lionfish counts distinct through correction, deletion, restoration and export", async () => {
  const { db, shop, trip, input } = await fixture();
  const lionfish = {
    kind: "lionfish_count",
    quantity: 3,
    location: "Reef",
    note: "Local removal program",
  };
  expect(
    await recordTripConservation(db, { ...input, fact: { ...lionfish, quantity: 1.5 } }),
  ).toEqual({ ok: false, reason: "invalid" });
  expect(await recordTripConservation(db, { ...input, fact: lionfish })).toEqual({ ok: true });
  const panel = await getTripConservationPanel(db, shop.id, trip.id, input.personId);
  const row = panel?.rows[0];
  if (!row) throw new Error("Expected lionfish record");
  expect(
    await recordTripConservation(db, {
      ...input,
      id: row.id,
      revision: 1,
      fact: { ...lionfish, quantity: 4 },
    }),
  ).toEqual({ ok: true });
  expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([
    { id: row.id, ...lionfish, quantity: 4 },
  ]);
  expect(
    await recordTripConservation(db, { ...input, id: row.id, revision: 2, operation: "delete" }),
  ).toEqual({ ok: true });
  expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([]);
  const exported = await loadShopExportBundleInput(db, shop.id);
  if (!exported) throw new Error("Expected shop export");
  const csv = table(exported, "trip_conservation.csv");
  const exportedRow = csv.rows.find((values) => values[0] === row.id);
  expect(exportedRow?.[csv.header.indexOf("kind")]).toBe("lionfish_count");
  expect(exportedRow?.[csv.header.indexOf("quantity")]).toBe(4);
  expect(exportedRow?.[csv.header.indexOf("deleted_at")]).not.toBeNull();
  expect(
    await recordTripConservation(db, { ...input, id: row.id, revision: 3, operation: "restore" }),
  ).toEqual({ ok: true });
  expect(await tripConservationFacts(db, shop.id, trip.id)).toEqual([
    { id: row.id, ...lionfish, quantity: 4 },
  ]);
});

it.each([0, -1, 1.5, 100001])(
  "the database refuses an invalid lionfish count %s",
  async (quantity) => {
    const { db, shop, trip, owner } = await fixture();
    await expect(
      db.insert(tripConservation).values({
        shopId: shop.id,
        tripId: trip.id,
        recordedByPersonId: owner.id,
        kind: "lionfish_count",
        quantity,
      }),
    ).rejects.toThrow();
  },
);
