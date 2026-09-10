import { and, eq, isNull } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { publicAppUrl } from "@/lib/notifications";
import { recipientLocale } from "@/lib/notifications/kinds";
import { shelfLinkPath } from "@/lib/shelf-links";
import type { AppDb } from "./client";
import { sendAndRecordNotification } from "./notifications";
import { issueShelfToken } from "./person-shelf-tokens";
import { people, shops } from "./schema";

/**
 * **"Send the link"** — the one act the diver record's shelf row offers.
 *
 * Mints a fresh shelf token and mails it to the address already on the diver's
 * record. Never to an address a staffer types: the whole point of the link is
 * that it opens this person's file, so the only safe recipient is the person
 * the file is about, as the shop already knows them.
 *
 * **Codes, never sentences** (ADR 20260731-domain-layer-copy-leaks). Each
 * outcome below is one the staff surface words for itself.
 */
export type ShelfLinkSendOutcome =
  /** Minted and handed to the provider. */
  | "sent"
  /** No address on file, so there is nothing to send to. */
  | "no_email"
  /** This shop has no such live diver — deleted, erased, or merged away. */
  | "unavailable"
  /** A provider that is unconfigured, refused, or errored. Never claim it went. */
  | "failed";

export async function sendShelfLink(
  db: AppDb,
  input: { shopId: string; personId: string; now?: Date },
): Promise<ShelfLinkSendOutcome> {
  const now = input.now ?? nowDate();
  const [row] = await db
    .select({
      email: people.email,
      fullName: people.fullName,
      personLocale: people.locale,
      shopName: shops.name,
      shopLocale: shops.defaultLocale,
    })
    .from(people)
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(
      and(
        eq(people.id, input.personId),
        eq(people.shopId, input.shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
      ),
    )
    .limit(1);
  if (!row) return "unavailable";
  if (!row.email) return "no_email";

  const origin = publicAppUrl();
  if (!origin) return "failed";

  // Minted **before** the send and left standing if the send fails. A token
  // nobody received is a row with no opens, which is exactly what the record's
  // "how many phones hold it" already reports as zero — and revoking it on a
  // provider error would be worse, because a message SES accepted and this
  // process never saw the ack for would then carry a dead link.
  const issued = await issueShelfToken(db, {
    shopId: input.shopId,
    personId: input.personId,
    now,
  });
  if (!issued) return "unavailable";

  const result = await sendAndRecordNotification(db, {
    kind: "shelf_link",
    personId: input.personId,
    shopId: input.shopId,
    to: row.email,
    locale: recipientLocale(row.personLocale, row.shopLocale),
    diverName: row.fullName,
    shopName: row.shopName,
    shelfUrl: new URL(shelfLinkPath(issued.token), `${origin}/`).toString(),
    tokenId: issued.tokenId,
  });
  return result.status === "sent" ? "sent" : "failed";
}
