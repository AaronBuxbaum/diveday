import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { people, shops } from "@/db/schema";
import { createTrip, listStaff } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { getIncidentExport, getTripLogPage } from "./incident-export";

it("pairs screen portraits by roster identity while leaving the evidence document unchanged", async () => {
  const { db, shop } = await seededShopContext();
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Molasses"),
  );
  const owner = (await listStaff(db, shop.id)).find((row) => row.roles.includes("owner"))?.person;
  if (!trip || !owner) throw new Error("demo departure or owner missing");
  const manifest = await getTripManifest(db, shop.id, trip.id);
  if (!manifest || manifest.crew.length < 2) throw new Error("demo crew missing");
  const [first, second] = manifest.crew;
  await db
    .update(people)
    .set({ staffPhotoPath: "/first.webp", fullName: "Alpha Crew" })
    .where(eq(people.id, first.id));
  await db
    .update(people)
    .set({ staffPhotoPath: "/second.webp", fullName: "Zulu Crew" })
    .where(eq(people.id, second.id));
  const liveManifest = await getTripManifest(db, shop.id, trip.id);
  if (!liveManifest) throw new Error("manifest missing");
  const page = await getTripLogPage(db, shop.id, trip.id, owner.id);
  expect(page.allowed).toBe(true);
  if (!page.allowed || !page.doc) throw new Error("log unavailable");
  const photoFor = new Map([
    [first.id, "/first.webp"],
    [second.id, "/second.webp"],
  ]);
  for (const [index, member] of liveManifest.crew.entries()) {
    if (photoFor.has(member.id)) expect(page.crewPhotos[index]).toBe(photoFor.get(member.id));
    expect(page.doc.crew[index]?.fullName).toBe(member.fullName);
  }
  const evidence = await getIncidentExport(db, shop.id, trip.id, owner.id);
  expect(page.doc).toEqual(evidence);
  expect(JSON.stringify(page.doc)).not.toContain("/first.webp");
  await db.update(people).set({ fullName: "Alpha Crew" }).where(eq(people.id, second.id));
  const namesakes = await getTripLogPage(db, shop.id, trip.id, owner.id);
  if (!namesakes.allowed || !namesakes.doc) throw new Error("log unavailable");
  const sameNamePhotos = namesakes.doc.crew.flatMap((member, index) =>
    member.fullName === "Alpha Crew" ? [namesakes.crewPhotos[index]] : [],
  );
  expect(new Set(sameNamePhotos)).toEqual(new Set(["/first.webp", "/second.webp"]));
  await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, first.id));
  const removed = await getTripLogPage(db, shop.id, trip.id, owner.id);
  expect(removed.allowed).toBe(true);
  if (!removed.allowed || !removed.doc) throw new Error("log unavailable");
  const remainingPhotos = removed.doc.crew.flatMap((member, index) =>
    member.fullName === "Alpha Crew" ? [removed.crewPhotos[index]] : [],
  );
  expect(new Set(remainingPhotos)).toEqual(new Set([null, "/second.webp"]));
  const nonOwner = (await listStaff(db, shop.id)).find((entry) => !entry.roles.includes("owner"));
  if (!nonOwner) throw new Error("non-owner missing");
  expect(await getTripLogPage(db, shop.id, trip.id, nonOwner.person.id)).toEqual({
    allowed: false,
  });
  expect(
    await getTripLogPage(db, shop.id, "00000000-0000-4000-8000-000000000000", owner.id),
  ).toEqual({ allowed: true, doc: null, crewPhotos: [] });
  const [other] = await db
    .insert(shops)
    .values({ name: "Other", slug: "log-photo-other", timezone: "UTC" })
    .returning();
  const startsAt = nowDate();
  const tripOther = await createTrip(db, {
    shopId: other.id,
    title: "Other trip",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 3_600_000),
    capacity: 8,
    plannedDives: 1,
  });
  if (!tripOther) throw new Error("other trip missing");
  expect(await getTripLogPage(db, shop.id, tripOther.id, owner.id)).toEqual({
    allowed: true,
    doc: null,
    crewPhotos: [],
  });
});
