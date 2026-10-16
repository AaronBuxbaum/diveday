import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { undoAgencyCheck } from "./agency-check";
import { createBookingParty } from "./bookings";
import { subscribeManifestEvents } from "./manifest-events";
import {
  createNitroxCertification,
  reviewNitroxCertification,
  unreviewNitroxCertification,
} from "./nitrox";
import {
  createCertification,
  createSpecialtyCertification,
  reviewCertification,
  reviewSpecialtyCertification,
  unreviewCertification,
  unreviewSpecialtyCertification,
} from "./readiness";
import { bookings, certifications } from "./schema";
import { createTrip } from "./trips";
import { recordInPersonWaiver } from "./waivers-in-person";

/**
 * **A change to a diver's readiness evidence tells every manifest they are on
 * to re-read** (issue #2613). A manifest open on the dock tablet, or primed
 * offline, otherwise keeps showing a diver as cleared after the review that
 * cleared them is undone, and the crew boards from that screen. The event
 * carries nothing about readiness; it only says "re-read", once per live,
 * unsailed departure the person holds a seat on, and never for another trip.
 *
 * vitest.config.ts sets DATABASE_URL to "" for every worker, so these observe
 * the in-process dispatch (the same filtering the LISTEN/NOTIFY path has).
 */

const ctx = fileScopedShopContext();

async function tripIn(title: string, startsInMs: number) {
  const { db, shop } = ctx;
  const startsAt = new Date(nowDate().getTime() + startsInMs);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 8,
    plannedDives: 1,
  });
  if (!trip) throw new Error(`createTrip refused ${title}`);
  return trip;
}

/** A diver seated on two upcoming boats, with a third boat, a sailed one and a cancelled seat beside them. */
async function scene() {
  const { db, shop } = ctx;
  const first = await tripIn("First boat", 2 * DAY_MS);
  const second = await tripIn("Second boat", 3 * DAY_MS);
  const elsewhere = await tripIn("Boat they are not on", 4 * DAY_MS);
  const cancelledBoat = await tripIn("Boat they cancelled", 5 * DAY_MS);
  const sailed = await tripIn("Boat that left", -DAY_MS / 2);

  const seated = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: first.id,
      fullName: "Evidence Evie",
      email: "evie@example.com",
    },
  ]);
  if (!seated.ok) throw new Error(`booking failed: ${seated.reason}`);
  const personId = seated.bookings[0].personId;
  for (const trip of [second, cancelledBoat]) {
    const more = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Evidence Evie",
        email: "evie@example.com",
      },
    ]);
    if (!more.ok) throw new Error(`booking failed: ${more.reason}`);
  }
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.personId, personId), eq(bookings.tripId, cancelledBoat.id)));
  // Inserted rather than booked: `createBookingParty` refuses a boat that has left.
  await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: sailed.id, personId });
  return { db, shop, personId, first, second, elsewhere, cancelledBoat, sailed };
}

/** Run `act` while subscribed to every trip in `watched`; the ids that heard something, sorted. */
async function heardDuring(
  shopId: string,
  watched: readonly { id: string }[],
  act: () => Promise<unknown>,
): Promise<string[]> {
  const heard: string[] = [];
  const unsubscribers = watched.map((trip) =>
    subscribeManifestEvents(shopId, trip.id, () => heard.push(trip.id)),
  );
  try {
    await act();
  } finally {
    for (const unsubscribe of unsubscribers) unsubscribe();
  }
  return [...heard].sort();
}

function ids(...trips: readonly { id: string }[]) {
  return trips.map((trip) => trip.id).sort();
}

describe("a change to a diver's readiness evidence signals their manifests", () => {
  it("undoing a card review signals each upcoming departure they hold a seat on, and no other", async () => {
    const { db, shop, personId, first, second, elsewhere, cancelledBoat, sailed } = await scene();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-EVENT-UNDO",
    });
    if (!card) throw new Error("card insert failed");
    const reviewed = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    if (!reviewed.ok || !reviewed.certification.reviewedAt) throw new Error("review failed");
    const reviewedAt = reviewed.certification.reviewedAt;

    const heard = await heardDuring(
      shop.id,
      [first, second, elsewhere, cancelledBoat, sailed],
      () => unreviewCertification(db, { shopId: shop.id, certificationId: card.id, reviewedAt }),
    );

    expect(heard).toEqual(ids(first, second));
  });

  it("signals the same departures for a review, a specialty review and a nitrox review", async () => {
    const { db, shop, personId, first, second, elsewhere } = await scene();
    const level = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-EVENT-LEVEL",
    });
    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      specialty: "deep",
      identifier: "PADI-EVENT-DEEP",
    });
    const nitrox = await createNitroxCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "PADI-EVENT-EANX",
    });
    if (!level || !specialty || !nitrox) throw new Error("card insert failed");
    const base = { shopId: shop.id, status: "verified" } as const;

    for (const review of [
      () => reviewCertification(db, { ...base, certificationId: level.id }),
      () => reviewSpecialtyCertification(db, { ...base, certificationId: specialty.id }),
      () => reviewNitroxCertification(db, { ...base, certificationId: nitrox.id }),
    ]) {
      const heard = await heardDuring(shop.id, [first, second, elsewhere], review);
      expect(heard).toEqual(ids(first, second));
    }
  });

  it("signals when a specialty or nitrox review is undone", async () => {
    const { db, shop, personId, first, second, elsewhere } = await scene();
    const specialty = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      specialty: "wreck",
      identifier: "PADI-EVENT-WRECK",
    });
    const nitrox = await createNitroxCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      identifier: "PADI-EVENT-NX2",
    });
    if (!specialty || !nitrox) throw new Error("card insert failed");
    const base = { shopId: shop.id, status: "verified" } as const;
    const wreck = await reviewSpecialtyCertification(db, {
      ...base,
      certificationId: specialty.id,
    });
    const eanx = await reviewNitroxCertification(db, { ...base, certificationId: nitrox.id });
    if (
      !wreck.ok ||
      !eanx.ok ||
      !wreck.certification.reviewedAt ||
      !eanx.certification.reviewedAt
    ) {
      throw new Error("review failed");
    }
    const wreckAt = wreck.certification.reviewedAt;
    const eanxAt = eanx.certification.reviewedAt;

    expect(
      await heardDuring(shop.id, [first, second, elsewhere], () =>
        unreviewSpecialtyCertification(db, {
          shopId: shop.id,
          certificationId: specialty.id,
          reviewedAt: wreckAt,
        }),
      ),
    ).toEqual(ids(first, second));
    expect(
      await heardDuring(shop.id, [first, second, elsewhere], () =>
        unreviewNitroxCertification(db, {
          shopId: shop.id,
          certificationId: nitrox.id,
          reviewedAt: eanxAt,
        }),
      ),
    ).toEqual(ids(first, second));
  });

  it("says nothing when the write was refused", async () => {
    const { db, shop, personId, first, second } = await scene();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-EVENT-REFUSED",
    });
    if (!card) throw new Error("card insert failed");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });

    const heard = await heardDuring(shop.id, [first, second], () =>
      unreviewCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        // Not the review on the row: a stale Undo (issue #2612).
        reviewedAt: new Date(0),
      }),
    );

    expect(heard).toEqual([]);
  });

  it("signals the diver's boats when the agency check's own Undo takes a review back, after it commits", async () => {
    const { db, shop, personId, first, second, elsewhere } = await scene();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-EVENT-AGENCY",
    });
    if (!card) throw new Error("card insert failed");
    await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
      agencyChecked: true,
      reviewNote: "PADI page lists this diver.",
    });

    let standingAtEvent: string | undefined;
    const heard = await heardDuring(shop.id, [first, second, elsewhere], async () => {
      const unsubscribe = subscribeManifestEvents(shop.id, first.id, () => {
        void db
          .select({ status: certifications.status })
          .from(certifications)
          .where(eq(certifications.id, card.id))
          .then((rows) => {
            standingAtEvent = rows[0]?.status;
          });
      });
      try {
        await undoAgencyCheck(db, {
          shopId: shop.id,
          personId,
          certificationId: card.id,
          undoneByPersonId: owner,
        });
      } finally {
        unsubscribe();
      }
    });

    expect(heard).toEqual(ids(first, second));
    // The re-read a device makes on the event already finds the card undone.
    await vi.waitFor(() => expect(standingAtEvent).toBe("pending"));
  });

  it("signals when a paper release is recorded for the diver", async () => {
    const { db, shop, personId, first, second, elsewhere } = await scene();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);

    const heard = await heardDuring(shop.id, [first, second, elsewhere], () =>
      recordInPersonWaiver(db, {
        shopId: shop.id,
        subject: { personId },
        recordedByPersonId: owner,
        medicalAttested: true,
      }),
    );

    expect(heard).toEqual(ids(first, second));
  });

  it("never reaches another shop's subscribers", async () => {
    const { db, shop, personId, first } = await scene();
    const card = await createCertification(db, {
      shopId: shop.id,
      personId,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-EVENT-TENANT",
    });
    if (!card) throw new Error("card insert failed");
    const heard: string[] = [];
    const unsubscribe = subscribeManifestEvents("another-shop", first.id, () => heard.push("x"));
    try {
      await reviewCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        status: "verified",
      });
    } finally {
      unsubscribe();
    }
    expect(heard).toEqual([]);
  });
});
