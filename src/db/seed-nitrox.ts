import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { bookings, importedPaymentHistory, nitroxCertifications, priorVisits } from "./schema";
import { dateAt } from "./seed-clock";

/**
 * Nitrox demo: a couple of verified EANx cards (and one pending), plus an
 * Nitrox request on the wreck charter — so the prep list shows a real
 * mix split and a real card gate the moment a fresh checkout boots.
 */
export async function seedNitrox(
  db: DbExecutor,
  shopId: string,
  customers: { id: string }[],
  wreck: { id: string },
  bookingRows: { id: string; tripId: string; personId: string }[],
): Promise<void> {
  // Two verified EANx cards, one still pending review.
  await db.insert(nitroxCertifications).values([
    {
      shopId,
      personId: customers[0].id,
      agency: "padi" as const,
      identifier: "EANX-0001",
      status: "verified" as const,
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: customers[1].id,
      agency: "ssi" as const,
      identifier: "EANX-0002",
      status: "verified" as const,
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: customers[2].id,
      agency: "padi" as const,
      identifier: "EANX-0003",
      status: "pending" as const,
    },
  ]);

  // The Duane wreck readiness track (see the extended-roster certs/specialty
  // above): three EANx cards verified, one still pending — the same "almost
  // ready" spread the rest of the roster gets.
  const duaneNitroxPlan: Array<[number, "verified" | "pending"]> = [
    [18, "verified"],
    [19, "verified"],
    [20, "verified"],
    [22, "pending"],
  ];
  const duaneNitroxRows = duaneNitroxPlan
    .map(([index, status]) => {
      const person = customers[index];
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        agency: "padi" as const,
        identifier: `EANX-${String(index + 1).padStart(4, "0")}`,
        status,
        reviewedAt: status === "verified" ? nowDate() : null,
      };
    })
    .filter((row) => row !== null);
  if (duaneNitroxRows.length > 0) await db.insert(nitroxCertifications).values(duaneNitroxRows);

  // The imported nitrox state, on the same diver as the imported specialty card
  // above: verified so it is never a boarding blocker, unconfirmed so the *fill*
  // still gives plain air (authorizesNitroxFill) and the confirm asks the staffer
  // to attest they have seen the card (H-24).
  if (customers[12]) {
    await db.insert(nitroxCertifications).values([
      {
        shopId,
        personId: customers[12].id,
        agency: "padi" as const,
        identifier: "EANX-0013",
        status: "verified" as const,
        importedAt: nowDate(),
        importedFromLabel: "Coral Coast Divers",
      },
    ]);
  }

  // History carried in from the shop's previous system, on the same diver as
  // the imported cards above (ADR 20260725-import-prior-visits). Hana is booked
  // on nothing, so her history can never touch a seeded trip's readiness,
  // manifest, or Today queue — which is also the point being demonstrated:
  // imported visits are inert.
  //
  // The three rows are the three shapes the profile has to render honestly: a
  // completed booking, one the old system recorded as cancelled (struck through,
  // never counted as a dive), and one with no price on it. Clock-anchored like
  // every other seeded date so the visual baseline stays pixel-stable.
  if (customers[12]) {
    await db.insert(priorVisits).values([
      {
        shopId,
        personId: customers[12].id,
        visitedOn: dateAt(-384),
        title: "Two-tank morning — Molasses Reef",
        statusLabel: "Completed",
        amountLabel: "$165.00",
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-20418",
        dedupeKey: "ref:ccd-20418",
        importedAt: nowDate(),
      },
      {
        shopId,
        personId: customers[12].id,
        visitedOn: dateAt(-201),
        title: "Night dive — Benwood Wreck",
        statusLabel: "Cancelled",
        amountLabel: "$95.00",
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-22677",
        dedupeKey: "ref:ccd-22677",
        importedAt: nowDate(),
      },
      {
        shopId,
        personId: customers[12].id,
        visitedOn: dateAt(-97),
        title: "Drysuit specialty — pool session",
        statusLabel: "Completed",
        amountLabel: null,
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-24003",
        dedupeKey: "ref:ccd-24003",
        importedAt: nowDate(),
      },
    ]);
    // Source payment/receipt evidence deliberately sits beside the imported
    // visits rather than becoming an order. The Orders visual surface needs a
    // real unverified row to keep its warning treatment reviewable; the refund
    // gives the aggregate its two-direction shape without touching Stripe or a
    // booking-payment gate.
    await db.insert(importedPaymentHistory).values([
      {
        shopId,
        personId: customers[12].id,
        occurredOn: dateAt(-384),
        direction: "payment" as const,
        title: "Two-tank morning — Molasses Reef",
        statusLabel: "Completed",
        amountLabel: "$165.00",
        amountCents: 16_500,
        currency: "usd",
        paymentReference: "PAY-CCD-20418",
        receiptReference: "RCPT-20418",
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-20418",
        stripeReference: null,
        dedupeKey: "payment:pay-ccd-20418",
        importedAt: nowDate(),
      },
      {
        shopId,
        personId: customers[12].id,
        occurredOn: dateAt(-201),
        direction: "refund" as const,
        title: "Night dive — Benwood Wreck",
        statusLabel: "Refunded",
        amountLabel: "$95.00",
        amountCents: 9_500,
        currency: "usd",
        paymentReference: "PAY-CCD-22677",
        receiptReference: null,
        sourceLabel: "Coral Coast Divers",
        sourceReference: "CCD-22677",
        stripeReference: null,
        dedupeKey: "payment:pay-ccd-22677",
        importedAt: nowDate(),
      },
    ]);
  }

  // A Nitrox request from a diver whose card is verified, on the
  // nitrox-required wreck charter.
  const wreckBookingForCert = bookingRows.find(
    (b) => b.tripId === wreck.id && b.personId === customers[0].id,
  );
  if (wreckBookingForCert) {
    await db
      .update(bookings)
      .set({ wantsNitrox: true })
      .where(eq(bookings.id, wreckBookingForCert.id));
  }
}
