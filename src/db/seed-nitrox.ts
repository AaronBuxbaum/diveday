import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { bookings, importedPaymentHistory, nitroxCertifications, priorVisits } from "./schema";
import type { Cast } from "./seed-cast";
import { dateAt } from "./seed-clock";
import { reviewedBy } from "./seed-review";

/**
 * Nitrox demo: a couple of verified EANx cards (and one pending), plus an
 * Nitrox request on the wreck charter — so the prep list shows a real
 * mix split and a real card gate the moment a fresh checkout boots.
 */
export async function seedNitrox(
  db: DbExecutor,
  shopId: string,
  cast: Cast<{ id: string; fullName: string }>,
  wreck: { id: string },
  bookingRows: { id: string; tripId: string; personId: string }[],
  /** The staffer every verified card here was checked by — see `reviewedBy`. */
  reviewerId: string,
): Promise<void> {
  // Two verified EANx cards, one still pending review.
  await db.insert(nitroxCertifications).values([
    {
      shopId,
      personId: cast.priya.id,
      agency: "padi" as const,
      identifier: "EANX-0001",
      status: "verified" as const,
      ...reviewedBy(reviewerId),
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: cast.tom.id,
      agency: "ssi" as const,
      identifier: "EANX-0002",
      status: "verified" as const,
      ...reviewedBy(reviewerId),
      reviewedAt: nowDate(),
    },
    {
      shopId,
      personId: cast.lena.id,
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
      const person = cast.slot(index);
      if (!person) return null;
      return {
        shopId,
        personId: person.id,
        agency: "padi" as const,
        identifier: `EANX-${String(index + 1).padStart(4, "0")}`,
        status,
        // The review is a pair — the date and the staffer who made it. This row
        // carried only the date, so the departure log fell to "Certified —
        // reviewer not recorded" (issue #625).
        ...(status === "verified" ? reviewedBy(reviewerId) : { reviewedAt: null }),
      };
    })
    .filter((row) => row !== null);
  if (duaneNitroxRows.length > 0) await db.insert(nitroxCertifications).values(duaneNitroxRows);
  await db.insert(nitroxCertifications).values([
    {
      shopId,
      personId: cast.hana.id,
      agency: "padi" as const,
      identifier: "EANX-0013",
      status: "verified" as const,
      // No reviewer and no date, deliberately: an import is not a review, and
      // `importedAt IS NOT NULL AND reviewedAt IS NULL` is the exact pair that
      // raises the "certified · confirm to clear" nudge (H-20260725-two-findings-dive-domain).
      importedAt: nowDate(),
      importedFromLabel: "Coral Coast Divers",
    },
  ]);
  await db.insert(priorVisits).values([
    {
      shopId,
      personId: cast.hana.id,
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
      personId: cast.hana.id,
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
      personId: cast.hana.id,
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
      personId: cast.hana.id,
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
      personId: cast.hana.id,
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

  // A Nitrox request from a diver whose card is verified, on the
  // nitrox-required wreck charter.
  const wreckBookingForCert = bookingRows.find(
    (b) => b.tripId === wreck.id && b.personId === cast.priya.id,
  );
  if (wreckBookingForCert) {
    await db
      .update(bookings)
      .set({ wantsNitrox: true })
      .where(eq(bookings.id, wreckBookingForCert.id));
  }
}
