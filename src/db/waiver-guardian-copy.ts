import { and, eq } from "drizzle-orm";
import { recipientLocale } from "@/lib/notifications/kinds";
import type { NotificationProvider } from "@/lib/notifications/provider";
import type { AppDb } from "./client";
import { sendAndRecordNotification } from "./notifications";
import { people, shops, waiverRecords } from "./schema";

/**
 * **The copy a co-signing parent gets of the release they just signed** (issue
 * #1453, owner decision 2026-09-10: "send a copy where there is an address, and
 * stop refusing a family that has none").
 *
 * The guardian's address was collected on every minor's release and read by
 * nothing but the export bundle and the erasure path. That is the wrong end of
 * two promises at once — a parent gets no acknowledgement of a liability
 * release they put their name to, and DiveDay holds a third party's personal
 * data under no stated purpose. This is the purpose.
 *
 * **Where it is called from, and why it is here rather than in the route.**
 * `/waivers/[token]`'s completion action calls it once inside `after(…)`, the
 * established post-response deferral (cf. `src/app/actions/inquiry.ts`): the
 * family is watching for their signed state, and a stalled provider must never
 * be between them and it. The route contributes one line; every decision about
 * what is sent lives here.
 *
 * **Deliberately not sent for a paper record.** `recordInPersonWaiver` stores
 * `guardian_email = null` by design — no address is collected on paper — so
 * the null check below covers that case with no branch of its own.
 */
export type GuardianReleaseCopyOutcome =
  | { sent: true }
  | {
      sent: false;
      /**
       * `no_guardian_email` is the ordinary answer and not a failure: a paper
       * record, or a family who gave none. `not_found` means the record, its
       * diver or its shop was gone by the time the deferral ran.
       */
      reason: "no_guardian_email" | "not_found" | "not_co_signed";
    };

export async function sendGuardianReleaseCopy(
  db: AppDb,
  input: { shopId: string; recordId: string },
  options: { provider?: NotificationProvider } = {},
): Promise<GuardianReleaseCopyOutcome> {
  const [row] = await db
    .select({
      guardianName: waiverRecords.guardianName,
      guardianEmail: waiverRecords.guardianEmail,
      guardianSignedAt: waiverRecords.guardianSignedAt,
      templateTitle: waiverRecords.templateTitle,
      templateVersion: waiverRecords.templateVersion,
      signedAt: waiverRecords.signedAt,
      diverName: people.fullName,
      diverEmail: people.email,
      shopName: shops.name,
      timezone: shops.timezone,
      shopDefaultLocale: shops.defaultLocale,
    })
    .from(waiverRecords)
    .innerJoin(people, eq(people.id, waiverRecords.personId))
    .innerJoin(shops, eq(shops.id, waiverRecords.shopId))
    // Shop-scoped as well as id-scoped: this is reached from a bearer-token
    // route, and a record id alone is not a tenant.
    .where(and(eq(waiverRecords.id, input.recordId), eq(waiverRecords.shopId, input.shopId)))
    .limit(1);
  if (!row) return { sent: false, reason: "not_found" };
  // Nothing is sent about a release nobody co-signed — an adult's, or a
  // half-written row. The signature's own timestamp is the fact, not the name,
  // which erasure takes.
  if (!row.guardianSignedAt || !row.signedAt) return { sent: false, reason: "not_co_signed" };
  if (!row.guardianEmail || !row.guardianName) return { sent: false, reason: "no_guardian_email" };

  await sendAndRecordNotification(
    db,
    {
      kind: "guardian_release_copy",
      waiverRecordId: input.recordId,
      shopId: input.shopId,
      to: row.guardianEmail,
      // **The shop's own language, always.** A guardian has no `people` row by
      // design (ADR 20260907-guardian-co-signature, decision 2), so there is no
      // first-hand locale signal to prefer — `recipientLocale` falls straight
      // back to the shop's default, which is the rule stated in `kinds.ts`.
      locale: recipientLocale(null, row.shopDefaultLocale),
      guardianName: row.guardianName,
      diverName: row.diverName,
      shopName: row.shopName,
      releaseTitle: row.templateTitle,
      releaseVersion: row.templateVersion,
      signedAt: row.signedAt,
      timezone: row.timezone,
      // So legal erasure can reach a queued copy about this diver
      // (`notificationSubjectEmail`; issue #1298's hole, closed here before it
      // is opened). Null on a diver with no address of their own.
      diverEmail: row.diverEmail ?? undefined,
    },
    options,
  );
  return { sent: true };
}
