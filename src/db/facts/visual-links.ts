import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  claimBookkeeperMonth,
  consumeBookkeeperConfirmation,
  issueBookkeeperConfirmation,
  setBookkeeper,
} from "@/db/bookkeeper";
import type { AppDb } from "@/db/client";
import { ownerLogins } from "@/db/owner-logins";
import { userAccounts, weeklyDigestSends } from "@/db/schema";
import { setShopShoreAlertContact } from "@/db/shops";
import { issueShoreAlertConfirmation, issueShoreAlertStopToken } from "@/db/shore-alert-tokens";
import { issueWeeklyDigestUnsubscribeToken } from "@/db/weekly-digest";
import { BOOKKEEPER_CONFIRMATION_TTL_MS, bookkeeperMonthOnSet } from "@/lib/bookkeeper";
import { addMonths, monthKey, parseMonthKey } from "@/lib/calendar";
import { SHORE_ALERT_CONFIRMATION_TTL_MS } from "@/lib/shore-alert-contact";
import { digestWeeks } from "@/lib/weekly-digest";
import { FactRefused } from "./refusal";

export const visualLinkArgs = z
  .object({
    family: z.enum([
      "shore-confirm",
      "shore-stop",
      "bookkeeper-confirm",
      "bookkeeper-stop",
      "digest",
    ]),
    state: z.enum(["active", "expired"]).default("active"),
  })
  .strict()
  .refine(({ family, state }) => state !== "expired" || family.endsWith("-confirm"));

/**
 * **The consent and opt-out links that otherwise exist only inside email**
 * (`visualLink`): the shore-alert confirmation and stop, the bookkeeper's
 * confirmation and stop, and the weekly digest's unsubscribe, each through the
 * real setters, issuers and hashed claim format, so the capture drives each
 * real public page and action. A private shop's fact: each changes settings.
 */
export async function mintAVisualLink(
  db: AppDb,
  shop: { id: string; timezone: string },
  { family, state }: z.output<typeof visualLinkArgs>,
  now: Date,
) {
  const [owner] = await ownerLogins(db, shop.id);
  if (!owner) throw new FactRefused("owner_not_found");
  let token: string;

  if (family === "digest") {
    // The sender's own shape: this week's claim, then the opt-out link the
    // email carries, without sending mail or depending on whether this
    // week's facts are quiet.
    const [claim] = await db
      .insert(weeklyDigestSends)
      .values({
        shopId: shop.id,
        personId: owner.personId,
        weekOf: digestWeeks(now, shop.timezone).weekOf,
        status: "sent",
      })
      .onConflictDoNothing()
      .returning({ id: weeklyDigestSends.id });
    if (!claim) throw new FactRefused("digest_already_seeded");
    token = await issueWeeklyDigestUnsubscribeToken(db, {
      shopId: shop.id,
      personId: owner.personId,
    });
    await db
      .update(userAccounts)
      .set({ weeklyDigest: true })
      .where(eq(userAccounts.personId, owner.personId));
  } else if (family.startsWith("shore-")) {
    const email = "shore.audit@example.com";
    await setShopShoreAlertContact(db, shop.id, {
      email,
      consentAt: now,
      consentByPersonId: owner.personId,
      confirmedAt: family === "shore-stop" ? now : null,
    });
    if (family === "shore-stop") {
      token = await issueShoreAlertStopToken(db, { shopId: shop.id, email });
    } else {
      const issued = await issueShoreAlertConfirmation(db, {
        shopId: shop.id,
        email,
        now:
          state === "expired" ? new Date(now.getTime() - SHORE_ALERT_CONFIRMATION_TTL_MS - 1) : now,
      });
      token = issued.token;
    }
  } else {
    const email = "books.audit@example.com";
    // Clear first so a prior capture cannot leave this address confirmed.
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email: null,
      personId: owner.personId,
      now,
    });
    await setBookkeeper(db, {
      shopId: shop.id,
      timeZone: shop.timezone,
      email,
      personId: owner.personId,
      now,
    });
    const issued = await issueBookkeeperConfirmation(db, {
      shopId: shop.id,
      email,
      now: state === "expired" ? new Date(now.getTime() - BOOKKEEPER_CONFIRMATION_TTL_MS - 1) : now,
    });
    if (!issued) throw new Error("Visual fixture could not issue its bookkeeper confirmation");
    token = issued.token;
    if (family === "bookkeeper-stop") {
      await consumeBookkeeperConfirmation(db, { token, now, origin: null });
      const previous = parseMonthKey(bookkeeperMonthOnSet(now, shop.timezone));
      if (!previous) throw new Error("Visual fixture has no bookkeeper month");
      const claim = await claimBookkeeperMonth(db, {
        shopId: shop.id,
        email,
        setByPersonId: owner.personId,
        month: monthKey(addMonths(previous, 1)),
      });
      if (!claim) throw new Error("Visual fixture could not claim its bookkeeper month");
      token = claim.stopToken;
    }
  }

  const prefix = family.endsWith("-confirm") ? "/confirm-contact" : "/unsubscribe";
  return { token, path: `${prefix}/${token}` };
}
