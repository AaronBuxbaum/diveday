import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "@/db/client";
import { bookingCapabilities } from "@/db/schema";
import { readinessWaiverLinkPath } from "@/lib/booking-capabilities";
import { bookingLinkToken } from "@/lib/booking-link-token";
import { FactRefused } from "./refusal";

export const waiverRequestLinkArgs = z.object({ bookingId: z.string().uuid() }).strict();

/**
 * **The Sign link a seat's waiver request carried** (`waiverRequestLink`): the
 * mailbox a spec does not have. A staffer's "Send waiver" hands a seat's
 * release to its holder as their thread link, `/ready/<token>/waiver`, and only
 * into a message to the contact on file (ADR 20261105-waiver-folds-into-the-thread,
 * no Copy link for a seat); e2e has no email provider, so the message is never
 * read. This reads the delivered readiness row that send left and spells its
 * token, the one the email carries. It writes nothing and mints nothing: a seat
 * nobody sent a request to is refused, so the spec has to have tapped the
 * button first.
 */
export async function readTheWaiverRequest(
  db: AppDb,
  shopId: string,
  { bookingId }: z.output<typeof waiverRequestLinkArgs>,
  now: Date,
) {
  const [row] = await db
    .select({
      id: bookingCapabilities.id,
      keyVersion: bookingCapabilities.keyVersion,
      purpose: bookingCapabilities.purpose,
    })
    .from(bookingCapabilities)
    .where(
      and(
        eq(bookingCapabilities.shopId, shopId),
        eq(bookingCapabilities.bookingId, bookingId),
        eq(bookingCapabilities.purpose, "readiness"),
        eq(bookingCapabilities.delivered, true),
        isNull(bookingCapabilities.revokedAt),
        isNull(bookingCapabilities.sourceCapabilityId),
        isNotNull(bookingCapabilities.keyVersion),
        gt(bookingCapabilities.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row || row.keyVersion === null) throw new FactRefused("not_sent", 404);
  const token = bookingLinkToken({ id: row.id, keyVersion: row.keyVersion, purpose: row.purpose });
  return { path: readinessWaiverLinkPath(token) };
}
