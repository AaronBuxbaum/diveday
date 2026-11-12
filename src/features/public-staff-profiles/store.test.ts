import { expect, it } from "vitest";
import { recordCrewAvailabilityBlock } from "@/db/crew-requests";
import { createTrip, listStaff, setTripCrew } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { writeOwnStaffProfile } from "./profiles";
import { assignedPublicStaffProfiles } from "./store";

const ctx = fileScopedShopContext();
it("introduces only assigned available instructors without using name-only consent", async () => {
  const { db, shop } = ctx;
  const staff = await listStaff(db, shop.id);
  const instructor = staff.find((entry) => entry.roles.includes("instructor"))?.person;
  const captain = staff.find((entry) => entry.roles.includes("captain"))?.person;
  if (!instructor || !captain) throw new Error("seeded staff missing");
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Profile lesson",
    startsAt: new Date("2027-03-14T15:00:00Z"),
    endsAt: new Date("2027-03-14T19:00:00Z"),
    capacity: 6,
    plannedDives: 1,
  });
  if (!trip) throw new Error("trip missing");
  await setTripCrew(db, shop.id, trip.id, [
    { personId: instructor.id, tripRole: "instructor" },
    { personId: captain.id, tripRole: "captain" },
  ]);
  for (const person of [instructor, captain])
    await writeOwnStaffProfile(db, {
      shopId: shop.id,
      personId: person.id,
      actorPersonId: person.id,
      enabled: true,
      profile: {
        firstName: person === instructor ? "Guide" : "Captain",
        role: "",
        sinceYear: null,
        languages: "",
        description: "Own introduction",
        photoUrls: [],
      },
    });
  expect(
    (await assignedPublicStaffProfiles(db, shop.id, [trip], shop.timezone, true)).map(
      (profile) => profile.firstName,
    ),
  ).toEqual(["Guide"]);
  expect(
    await assignedPublicStaffProfiles(
      db,
      "11111111-1111-4111-8111-111111111111",
      [trip],
      shop.timezone,
    ),
  ).toEqual([]);
  const away = await recordCrewAvailabilityBlock(db, {
    shopId: shop.id,
    personId: instructor.id,
    actorPersonId: instructor.id,
    canManageRoster: false,
    startsOn: "2027-03-14",
    endsOn: "2027-03-14",
    note: "Private family detail",
  });
  expect(away.ok).toBe(true);
  expect(await assignedPublicStaffProfiles(db, shop.id, [trip], shop.timezone, true)).toEqual([]);
  expect(
    (await assignedPublicStaffProfiles(db, shop.id, [trip], shop.timezone)).map(
      (profile) => profile.firstName,
    ),
  ).toEqual(["Captain"]);
});
