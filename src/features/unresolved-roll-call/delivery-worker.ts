import { and, count, eq } from "drizzle-orm";
import { lockBoardingCertificationEvidence } from "@/db/boarding-certification-snapshot";
import type { AppDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { ownerLogins } from "@/db/owner-logins";
import {
  people,
  personRoles,
  rollCallEventClaims,
  shops,
  trips,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertOutbox,
  userAccounts,
} from "@/db/schema";
import { liveTrip } from "@/db/trips";
import {
  type NotificationProvider,
  notificationProviderSignal,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { shopPath } from "@/lib/staff-notices";
import {
  ensureSafetyReviewDelivery,
  finishSafetyReviewDelivery,
  startSafetyReviewDelivery,
} from "./delivery-ledger";
import { unresolvedReviewAvailable } from "./review-availability";

/** No production implementation is supplied yet. This promise must be backed
 * by transport tests: one request, and abort must stop the provider operation. */
export type SafetyReviewProvider = NotificationProvider & {
  readonly safetySingleAttemptAbortable: true;
};

/** Includes prior recipients who are no longer active owners. */
async function deliveryLedgerSummary(db: AppDb, outboxId: string) {
  const rows = await db
    .select({ status: unresolvedSafetyAlertDeliveries.status, count: count() })
    .from(unresolvedSafetyAlertDeliveries)
    .where(eq(unresolvedSafetyAlertDeliveries.outboxId, outboxId))
    .groupBy(unresolvedSafetyAlertDeliveries.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
}

/** Process one server-owned obligation. Not scheduled or exposed to requests;
 * the feature gate stays false until review, recovery and alert escalation work. */
export async function dispatchUnresolvedSafetyReview(
  db: AppDb,
  outboxId: string,
  provider?: SafetyReviewProvider,
) {
  if (!unresolvedReviewAvailable() || !provider?.safetySingleAttemptAbortable)
    return { status: "unavailable" as const };
  const origin = publicAppUrl();
  if (!origin) return { status: "unavailable" as const };
  const [obligation] = await db
    .select()
    .from(unresolvedSafetyAlertOutbox)
    .where(eq(unresolvedSafetyAlertOutbox.id, outboxId))
    .limit(1);
  if (!obligation) return { status: "not_found" as const };
  const recipients = await ownerLogins(db, obligation.shopId);
  if (recipients.length === 0)
    return { status: "no_recipients" as const, ledger: await deliveryLedgerSummary(db, outboxId) };
  let delivered = 0;
  let alreadyDelivered = 0;
  let uncertain = 0;
  let pending = 0;
  for (const recipient of recipients) {
    const deliveryId = await ensureSafetyReviewDelivery(db, {
      outboxId,
      personId: recipient.personId,
    });
    const attemptId = await startSafetyReviewDelivery(db, deliveryId);
    if (!attemptId) {
      const [existing] = await db
        .select({ status: unresolvedSafetyAlertDeliveries.status })
        .from(unresolvedSafetyAlertDeliveries)
        .where(eq(unresolvedSafetyAlertDeliveries.id, deliveryId));
      if (existing?.status === "delivered") alreadyDelivered += 1;
      else if (existing?.status === "pending") pending += 1;
      else uncertain += 1;
      continue;
    }
    try {
      const outcome = await db.transaction(async (tx) => {
        await lockBoardingCertificationEvidence(tx, obligation.shopId, "boarding");
        await tx
          .select({ id: people.id })
          .from(people)
          // diveday:allow-deleted-people: lock before the live owner check below.
          .where(eq(people.id, recipient.personId))
          .for("share");
        await tx
          .select({ id: userAccounts.id })
          .from(userAccounts)
          .where(eq(userAccounts.personId, recipient.personId))
          .for("share");
        await tx
          .select({ role: personRoles.role })
          .from(personRoles)
          .where(eq(personRoles.personId, recipient.personId))
          .for("share");
        const [trip] = await tx
          .select({ id: trips.id, title: trips.title })
          .from(trips)
          .where(
            and(
              eq(trips.id, obligation.tripId),
              eq(trips.shopId, obligation.shopId),
              eq(trips.isRehearsal, false),
              liveTrip(),
            ),
          )
          .for("share");
        const [claim] = await tx
          .select({
            shopId: rollCallEventClaims.shopId,
            tripId: rollCallEventClaims.tripId,
            facts: rollCallEventClaims.retainedSafetyEvidence,
          })
          .from(rollCallEventClaims)
          .where(eq(rollCallEventClaims.id, obligation.claimId))
          .for("share");
        const [shop] = await tx
          .select({ slug: shops.slug, name: shops.name, locale: shops.defaultLocale })
          .from(shops)
          .where(and(eq(shops.id, obligation.shopId), eq(shops.isDemo, false)))
          .for("share");
        const current = (await ownerLogins(tx, obligation.shopId)).find(
          (owner) => owner.personId === recipient.personId,
        );
        if (
          !claim ||
          claim.shopId !== obligation.shopId ||
          claim.tripId !== obligation.tripId ||
          claim.facts?.receiptId !== obligation.generationId ||
          !trip ||
          !shop ||
          !current
        ) {
          const settled = await finishSafetyReviewDelivery(tx, {
            deliveryId,
            attemptId,
            outcome: "not_attempted",
          });
          return settled ? ("pending" as const) : ("uncertain" as const);
        }
        const signal = notificationProviderSignal();
        // Do not release the authorization/erasure locks while a losing
        // provider promise can still send. No production provider meets this
        // contract yet; the feature and this worker remain disabled.
        const delivery = await sendNotification(
          tx,
          {
            kind: "unresolved_safety_evidence",
            shopId: obligation.shopId,
            tripId: obligation.tripId,
            personId: current.personId,
            generationId: obligation.generationId,
            to: current.email,
            locale: recipientLocale(current.locale, shop.locale),
            recipientName: current.fullName,
            shopName: shop.name,
            tripTitle: trip.title,
            reviewUrl: `${origin}${shopPath(shop.slug, "trips", trip.id, "manifest")}`,
          },
          provider,
          { retryPolicy: "disabled", signal },
        );
        if (delivery.status === "sent") {
          const settled = await finishSafetyReviewDelivery(tx, {
            deliveryId,
            attemptId,
            outcome: "delivered",
            providerMessageId: delivery.providerMessageId,
          });
          return settled ? ("delivered" as const) : ("uncertain" as const);
        }
        if (delivery.status === "not_configured") {
          const settled = await finishSafetyReviewDelivery(tx, {
            deliveryId,
            attemptId,
            outcome: "not_configured",
          });
          return settled ? ("pending" as const) : ("uncertain" as const);
        }
        await finishSafetyReviewDelivery(tx, { deliveryId, attemptId, outcome: "uncertain" });
        return "uncertain" as const;
      });
      if (outcome === "delivered") delivered += 1;
      else if (outcome === "uncertain") uncertain += 1;
      else pending += 1;
    } catch {
      // A failure may follow provider acceptance. Preserve the unknown state;
      // never infer that no message went or silently send it again.
      await finishSafetyReviewDelivery(db, { deliveryId, attemptId, outcome: "uncertain" });
      uncertain += 1;
    }
  }
  return {
    status: "attempted" as const,
    delivered,
    alreadyDelivered,
    uncertain,
    pending,
    ledger: await deliveryLedgerSummary(db, outboxId),
  };
}
