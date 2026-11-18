import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { upsertExecutedDive } from "./executed-dives";
import { people, personRoles, trips } from "./schema";

it("records several species and preserves them when sightings are switched off", async () => {
  const { db, shop } = await seededShopContext();
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("missing fixture");
  const entries = [
    { slug: "green-sea-turtle", name: null },
    { slug: null, name: "Tiny shrimp" },
  ];
  const input = { shopId: shop.id, tripId: trip.id, diveNumber: 1, recordedByPersonId: owner.id };
  const saved = await upsertExecutedDive(db, { ...input, observedSpeciesEntries: entries });
  expect(saved).toMatchObject({ ok: true, dive: { observedSpeciesEntries: entries } });
  const kept = await upsertExecutedDive(db, { ...input, keepObservedSpecies: true });
  expect(kept).toMatchObject({ ok: true, dive: { observedSpeciesEntries: entries } });
  const cleared = await upsertExecutedDive(db, { ...input, observedSpeciesEntries: [] });
  expect(cleared).toMatchObject({ ok: true, dive: { observedSpeciesEntries: [] } });
});
