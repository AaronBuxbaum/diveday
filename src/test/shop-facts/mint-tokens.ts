import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { issueAccountToken } from "../../db/account-tokens";
import type { AppDb } from "../../db/client";
import { issuePersonCourtesyEmailUnsubscribeToken } from "../../db/courtesy-email";
import { issueInterestUnsubscribeToken } from "../../db/interests";
import { interests, people, setupRequests, shops, userAccounts } from "../../db/schema/index";
import { issueSetupLink } from "../../features/setup-links/store";
import { issueShopContactEmailConfirmation } from "../../features/shop-contact-email/store";
import { DEFAULT_DIVER_LOCALE } from "../../i18n/settings";
import { setupLinkPath } from "../../lib/setup-links";
import { FactRefused } from "./refusal";

/**
 * **The links that otherwise exist only inside an email.** Each mints a real,
 * valid capability through the product's own issuer and answers the raw token,
 * the only way a spec can drive the page and action behind it: the token is
 * otherwise readable only from inside the message, and hashed at rest. These
 * are the most sensitive facts in the registry (an account token is a password
 * reset for whoever holds it), which is why they are reachable only through the
 * test door's harness gate (`src/features/e2e-test-routes/rules.ts`).
 */

export const accountTokenArgs = z
  .object({
    email: z.string().trim().email(),
    purpose: z.enum(["email_verification", "password_reset", "invite"]),
  })
  .strict();

/**
 * **An account token** (`accountToken`) for `/verify/[token]`,
 * `/reset-password/[token]` or `/invite/[token]`. The account must already
 * exist: an invite's account is created by the real invite action
 * (`inviteStaffMember`); this re-mints a token for it, exactly like a resend.
 * The account is found by email across shops, because the owner a spec has
 * just onboarded belongs to a new shop of its own (20260725-account-lifecycle-emails).
 */
export async function mintAnAccountToken(db: AppDb, args: z.output<typeof accountTokenArgs>) {
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.email, args.email.toLowerCase()))
    .limit(1);
  // The one refusal (issue #2751): no separate "no such account" answer.
  if (!account) throw new FactRefused("not_available", 404);
  const issued = await issueAccountToken(db, {
    userAccountId: account.id,
    purpose: args.purpose,
  });
  return { token: issued.token, expiresAt: issued.expiresAt.toISOString() };
}

/**
 * **The shop's front-desk address confirmation** (`contactEmailConfirmation`)
 * for `/confirm-contact/[token]` (issue #1288), issued for the address the shop
 * holds now.
 */
export async function mintAContactEmailConfirmation(db: AppDb, shopId: string) {
  const [shop] = await db
    .select({ contactEmail: shops.contactEmail })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop?.contactEmail) throw new FactRefused("no_contact_email");
  const issued = await issueShopContactEmailConfirmation(db, { shopId, email: shop.contactEmail });
  return { token: issued.token };
}

export const emailArgs = z.object({ email: z.string().trim().email() }).strict();

async function personByEmail(db: AppDb, shopId: string, email: string) {
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        eq(people.email, email.toLowerCase()),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!person) throw new FactRefused("person_not_found", 404);
  return person;
}

/**
 * **A courtesy-email unsubscribe** (`courtesyEmailUnsubscribe`) for one of the
 * shop's people, the capability a `waitlist_invite` or `trip_recap` email
 * carries to `/unsubscribe/[token]`.
 */
export async function mintACourtesyEmailUnsubscribe(
  db: AppDb,
  shopId: string,
  { email }: z.output<typeof emailArgs>,
) {
  const person = await personByEmail(db, shopId, email);
  const token = await issuePersonCourtesyEmailUnsubscribeToken(db, {
    shopId,
    personId: person.id,
  });
  return { token };
}

/**
 * **A last-minute list unsubscribe** (`interestUnsubscribe`) for an existing
 * anytime interest, the capability a deal email carries to `/unsubscribe/[token]`.
 */
export async function mintAnInterestUnsubscribe(
  db: AppDb,
  shopId: string,
  { email }: z.output<typeof emailArgs>,
) {
  const [interest] = await db
    .select({ id: interests.id })
    .from(interests)
    .innerJoin(people, eq(people.id, interests.personId))
    .where(
      and(
        eq(interests.shopId, shopId),
        eq(interests.scope, "anytime"),
        eq(people.email, email.toLowerCase()),
        isNull(people.deletedAt),
      ),
    )
    .limit(1);
  if (!interest) throw new FactRefused("interest_not_found", 404);
  const token = await issueInterestUnsubscribeToken(db, { shopId, interestId: interest.id });
  return { token };
}

/**
 * **An open setup link** (`setupLink`, ADR 20261009-single-use-setup-links),
 * answered as the path it opens, so a spec onboards a shop through `/onboard`
 * the way the founder's mail would. It belongs to no shop: the request it hangs
 * on has empty answers, so the form's prefill leaves every field as a spec that
 * types into it expects. In a real deployment this would be a sign-up door.
 */
export async function mintASetupLink(db: AppDb) {
  const [row] = await db
    .insert(setupRequests)
    .values({
      shopName: "",
      region: "",
      runsBoat: false,
      currentSystem: "other",
      contactName: "",
      email: "",
      source: "unknown",
      locale: DEFAULT_DIVER_LOCALE,
    })
    .returning({ id: setupRequests.id });
  if (!row) throw new Error("setup link fixture: insert failed");
  const issued = await issueSetupLink(db, { setupRequestId: row.id });
  return { path: setupLinkPath(issued.token), expiresAt: issued.expiresAt.toISOString() };
}
