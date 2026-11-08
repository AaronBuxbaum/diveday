import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { people, waiverRecords } from "../../db/schema/index";
import { issueWaiverRequest, recordWaiverDelivery } from "../../db/waivers";
import { HOUR_MS, nowDate } from "../../lib/clock";

/**
 * Give Priya's outstanding release one failed email and one delivered text.
 *
 * Priya is the seed's deliberate waiver holdout (`src/db/seed-bookings.ts`), so her record offers
 * all four ways of getting a release signed, the record `diver-profile-paper-waiver` photographs at
 * rest. Issuing here keeps that capture calm; it is stamped an hour on, past her seat releases.
 */
export async function markMixedWaiverDelivery(db: AppDb, shopId: string): Promise<void> {
  const [priya] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Priya Sharma")))
    .limit(1);
  if (!priya) return;
  const issued = await issueWaiverRequest(db, { shopId, personId: priya.id });
  if (!issued.ok) return;
  const createdAt = new Date(nowDate().getTime() + HOUR_MS);
  await db.update(waiverRecords).set({ createdAt }).where(eq(waiverRecords.id, issued.recordId));
  // Email first, text second: the latest-attempt columns take the last write.
  await recordWaiverDelivery(db, {
    shopId,
    waiverRecordId: issued.recordId,
    channel: "email",
    delivery: { status: "failed", detail: "mailbox does not exist" },
  });
  await recordWaiverDelivery(db, {
    shopId,
    waiverRecordId: issued.recordId,
    channel: "sms",
    delivery: { status: "sent" },
  });
}
