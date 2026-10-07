import { eq } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { PlainTextProvider } from "@/lib/notifications/courtesy";
import type { AppDb } from "./client";
import { smsOptOuts } from "./schema";

/**
 * The STOP list for DiveDay's texting number (ADR 20261007-sms-stop-and-help).
 * One list for the platform, because every shop's texts leave from one number:
 * see the `sms_opt_outs` docblock in `schema.ts`.
 */

/** Record a STOP. A second STOP keeps the first one's time. */
export async function recordSmsOptOut(db: AppDb, phone: string, at: Date = nowDate()) {
  await db.insert(smsOptOuts).values({ phone, optedOutAt: at }).onConflictDoNothing();
}

/** Undo a STOP: the diver replied START. */
export async function clearSmsOptOut(db: AppDb, phone: string) {
  await db.delete(smsOptOuts).where(eq(smsOptOuts.phone, phone));
}

export async function isSmsOptedOut(db: AppDb, phone: string): Promise<boolean> {
  const rows = await db
    .select({ phone: smsOptOuts.phone })
    .from(smsOptOuts)
    .where(eq(smsOptOuts.phone, phone))
    .limit(1);
  return rows.length > 0;
}

/**
 * Wrap the platform SMS sender so a number on the STOP list is never texted.
 *
 * The refusal is a non-retryable `failed` with code `opted_out` rather than a
 * skip, so a phone-only diver's delivery row says why no text arrived instead
 * of looking like the channel was never set up. AWS refuses the same number on
 * its side too; this check is what makes the refusal ours and immediate.
 */
export function stopListedSmsProvider(db: AppDb, inner: PlainTextProvider): PlainTextProvider {
  return {
    async send(message) {
      if (await isSmsOptedOut(db, message.to)) {
        return { status: "failed", retryable: false, errorCode: "opted_out" };
      }
      return inner.send(message);
    },
  };
}
