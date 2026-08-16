import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { recordCourseInquiry } from "./course-inquiries";
import { getCourseBySlug } from "./courses";
import { listBookableDivers } from "./divers";
import { loadShopExportBundleInput } from "./export";
import { people, shops } from "./schema";
import {
  createDirectTripInvitation,
  createTripRequestInvitations,
  listTripInvitations,
  recordTripInvitation,
} from "./trip-invitations";
import { getTripRoster, getTripWithBooked, upcomingTripsWithCounts } from "./trips";
import { createTrip } from "./trips-create";

async function invitationContext() {
  const { db, shop } = await seededShopContext();
  const course = await getCourseBySlug(db, shop.id, "open-water-diver");
  if (!course) throw new Error("expected seeded course missing");
  const [author] = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.shopId, shop.id))
    .limit(1);
  if (!author) throw new Error("expected seeded person missing");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const firstTrip = trips.find((trip) => trip.title === "Two-Tank Reef — Christ of the Abyss");
  const secondTrip = trips.find((trip) => trip.title === "Wreck Trip — Spiegel Grove");
  if (!firstTrip || !secondTrip) throw new Error("expected seeded trips missing");
  return { db, shop, course, author, firstTrip, secondTrip };
}

async function makeRequest(
  db: Awaited<ReturnType<typeof invitationContext>>["db"],
  shopId: string,
  courseId: string,
  name: string,
) {
  return recordCourseInquiry(db, {
    shopId,
    courseId,
    name,
    email: `${name.toLowerCase().replaceAll(" ", ".")}@example.com`,
    experienceLevel: "certified",
    divers: 2,
  });
}

describe("trip invitations", () => {
  it("keeps request outreach outside capacity and allows one request on multiple trips", async () => {
    const { db, shop, course, author, firstTrip, secondTrip } = await invitationContext();
    const request = await makeRequest(db, shop.id, course.id, "Invitation Iris");
    const bookedBefore = await getTripWithBooked(db, shop.id, firstTrip.id);
    const rosterBefore = await getTripRoster(db, shop.id, firstTrip.id);

    await expect(
      createTripRequestInvitations(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(1);
    await expect(
      createTripRequestInvitations(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(0);
    await expect(
      createTripRequestInvitations(db, {
        shopId: shop.id,
        tripId: secondTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(1);

    expect(await getTripWithBooked(db, shop.id, firstTrip.id)).toMatchObject({
      booked: bookedBefore?.booked,
    });
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(rosterBefore.length);
    expect(await listTripInvitations(db, shop.id, firstTrip.id)).toHaveLength(1);
    expect(await listTripInvitations(db, shop.id, secondTrip.id)).toHaveLength(1);

    const bundle = await loadShopExportBundleInput(db, shop.id);
    const invitationTable = bundle?.tables.find((table) => table.file === "trip_invitations.csv");
    expect(invitationTable?.rows).toHaveLength(2);
    expect(invitationTable?.rows[0]?.[invitationTable.header.indexOf("source")]).toBe(
      "date_request",
    );
    expect(invitationTable?.rows[0]?.[invitationTable.header.indexOf("person_name")]).toBe(
      "Invitation Iris",
    );
  });

  it("shows the request contact and records outreach without creating a booking", async () => {
    const { db, shop, course, author, firstTrip, secondTrip } = await invitationContext();
    const request = await makeRequest(db, shop.id, course.id, "Invitation Ines");
    await createTripRequestInvitations(db, {
      shopId: shop.id,
      tripId: firstTrip.id,
      requestIds: [request.id],
      createdByPersonId: author.id,
    });

    const [listed] = await listTripInvitations(db, shop.id, firstTrip.id);
    if (!listed) throw new Error("invitation was not listed");
    expect(listed.request?.name).toBe("Invitation Ines");
    expect(listed.invitation.invitedAt).toBeNull();

    const now = new Date("2026-08-16T15:00:00.000Z");
    await expect(
      recordTripInvitation(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        invitationId: listed.invitation.id,
        now,
      }),
    ).resolves.toBe(true);
    const [after] = await listTripInvitations(db, shop.id, firstTrip.id);
    expect(after?.invitation.invitedAt?.toISOString()).toBe(now.toISOString());
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);

    await expect(
      recordTripInvitation(db, {
        shopId: shop.id,
        tripId: secondTrip.id,
        invitationId: listed.invitation.id,
      }),
    ).resolves.toBe(false);
  });

  it("supports a direct existing-diver invitation without seating them", async () => {
    const { db, shop, author, firstTrip } = await invitationContext();
    const [candidate] = await listBookableDivers(db, shop.id, firstTrip.id, {
      query: "example.com",
    });
    if (!candidate) throw new Error("expected a bookable seeded diver");

    await expect(
      createDirectTripInvitation(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        personId: candidate.person.id,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(true);
    await expect(
      createDirectTripInvitation(db, {
        shopId: shop.id,
        tripId: firstTrip.id,
        personId: candidate.person.id,
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(false);

    const [listed] = await listTripInvitations(db, shop.id, firstTrip.id);
    expect(listed?.invitation.source).toBe("direct");
    expect(listed?.person?.id).toBe(candidate.person.id);
    expect(await getTripRoster(db, shop.id, firstTrip.id)).toHaveLength(0);
  });

  it("does not attach a request across shop boundaries", async () => {
    const { db, shop, course, author, firstTrip } = await invitationContext();
    const request = await makeRequest(db, shop.id, course.id, "Tenant Tina");
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Invitation Shop", slug: "other-invitation-shop", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("other shop setup failed");
    const otherTrip = await createTrip(db, {
      shopId: otherShop.id,
      title: "Other Trip",
      startsAt: new Date("2026-09-01T12:00:00.000Z"),
      endsAt: new Date("2026-09-01T16:00:00.000Z"),
      capacity: 12,
    });
    if (!otherTrip) throw new Error("other trip setup failed");

    await expect(
      createTripRequestInvitations(db, {
        shopId: otherShop.id,
        tripId: otherTrip.id,
        requestIds: [request.id],
        createdByPersonId: author.id,
      }),
    ).resolves.toBe(0);
    expect(await listTripInvitations(db, otherShop.id, otherTrip.id)).toEqual([]);
    expect(await listTripInvitations(db, shop.id, firstTrip.id)).toEqual([]);
  });
});
