import { asc, eq, inArray } from "drizzle-orm";
import type { Role } from "@/lib/authz";
import type { ShopExportData } from "@/lib/export";
import type { AppDb } from "./client";
import {
  bookingPayments,
  bookings,
  certifications,
  courses,
  diveSites,
  nitroxCertifications,
  orderLineItems,
  orders,
  people,
  personRoles,
  rentalFitProfiles,
  rollCallEvents,
  shops,
  specialtyCertifications,
  tripAssignments,
  tripDives,
  tripRequirements,
  tripSeries,
  trips,
  tripWaitlistEntries,
  waiverRecords,
  waiverTemplates,
} from "./schema";

/**
 * Everything one shop owns, loaded for the full-shop export
 * (src/lib/export.ts). Every read is scoped by shop_id; `trip_dives` and
 * `trip_assignments` carry no shop_id of their own, so they scope through an
 * inner join on the shop's trips — nothing in the bundle may reach another
 * tenant. Archived rows (deletedAt set) are included deliberately: they are
 * still the shop's history, and the CSVs carry the archived_at column.
 */
export async function loadShopExport(db: AppDb, shopId: string): Promise<ShopExportData | null> {
  const [shop] = await db.select().from(shops).where(eq(shops.id, shopId)).limit(1);
  if (!shop) return null;

  const peopleRows = await db
    .select()
    .from(people)
    .where(eq(people.shopId, shopId))
    .orderBy(asc(people.createdAt), asc(people.id));
  const roleRows = peopleRows.length
    ? await db
        .select()
        .from(personRoles)
        .where(
          inArray(
            personRoles.personId,
            peopleRows.map((person) => person.id),
          ),
        )
    : [];
  const rolesByPerson = new Map<string, Role[]>();
  for (const row of roleRows) {
    const roles = rolesByPerson.get(row.personId) ?? [];
    roles.push(row.role);
    rolesByPerson.set(row.personId, roles);
  }

  return {
    shop,
    people: peopleRows.map((person) => ({
      ...person,
      roles: (rolesByPerson.get(person.id) ?? []).sort(),
    })),
    certifications: await db
      .select()
      .from(certifications)
      .where(eq(certifications.shopId, shopId))
      .orderBy(asc(certifications.createdAt), asc(certifications.id)),
    specialtyCertifications: await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.shopId, shopId))
      .orderBy(asc(specialtyCertifications.createdAt), asc(specialtyCertifications.id)),
    nitroxCertifications: await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.shopId, shopId))
      .orderBy(asc(nitroxCertifications.createdAt), asc(nitroxCertifications.id)),
    waiverTemplates: await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shopId))
      .orderBy(asc(waiverTemplates.createdAt), asc(waiverTemplates.id)),
    waiverRecords: await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.shopId, shopId))
      .orderBy(asc(waiverRecords.createdAt), asc(waiverRecords.id)),
    trips: await db
      .select()
      .from(trips)
      .where(eq(trips.shopId, shopId))
      .orderBy(asc(trips.startsAt), asc(trips.id)),
    tripDives: (
      await db
        .select({ dive: tripDives })
        .from(tripDives)
        .innerJoin(trips, eq(tripDives.tripId, trips.id))
        .where(eq(trips.shopId, shopId))
        .orderBy(asc(tripDives.tripId), asc(tripDives.diveNumber))
    ).map((row) => row.dive),
    tripRequirements: await db
      .select()
      .from(tripRequirements)
      .where(eq(tripRequirements.shopId, shopId))
      .orderBy(asc(tripRequirements.createdAt), asc(tripRequirements.tripId)),
    tripSeries: await db
      .select()
      .from(tripSeries)
      .where(eq(tripSeries.shopId, shopId))
      .orderBy(asc(tripSeries.createdAt), asc(tripSeries.id)),
    tripAssignments: await db
      .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(tripAssignments.tripId, trips.id))
      .where(eq(trips.shopId, shopId))
      .orderBy(asc(tripAssignments.tripId), asc(tripAssignments.personId)),
    bookings: await db
      .select()
      .from(bookings)
      .where(eq(bookings.shopId, shopId))
      .orderBy(asc(bookings.createdAt), asc(bookings.id)),
    waitlistEntries: await db
      .select()
      .from(tripWaitlistEntries)
      .where(eq(tripWaitlistEntries.shopId, shopId))
      .orderBy(asc(tripWaitlistEntries.createdAt), asc(tripWaitlistEntries.id)),
    bookingPayments: await db
      .select()
      .from(bookingPayments)
      .where(eq(bookingPayments.shopId, shopId))
      .orderBy(asc(bookingPayments.createdAt), asc(bookingPayments.id)),
    orders: await db
      .select()
      .from(orders)
      .where(eq(orders.shopId, shopId))
      .orderBy(asc(orders.createdAt), asc(orders.id)),
    orderLineItems: await db
      .select()
      .from(orderLineItems)
      .where(eq(orderLineItems.shopId, shopId))
      .orderBy(asc(orderLineItems.createdAt), asc(orderLineItems.id)),
    rollCallEvents: await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.shopId, shopId))
      .orderBy(asc(rollCallEvents.occurredAt), asc(rollCallEvents.id)),
    rentalFitProfiles: await db
      .select()
      .from(rentalFitProfiles)
      .where(eq(rentalFitProfiles.shopId, shopId))
      .orderBy(asc(rentalFitProfiles.createdAt), asc(rentalFitProfiles.id)),
    diveSites: await db
      .select()
      .from(diveSites)
      .where(eq(diveSites.shopId, shopId))
      .orderBy(asc(diveSites.createdAt), asc(diveSites.id)),
    courses: await db
      .select()
      .from(courses)
      .where(eq(courses.shopId, shopId))
      .orderBy(asc(courses.createdAt), asc(courses.id)),
  };
}
