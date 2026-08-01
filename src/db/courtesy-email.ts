import { eq } from "drizzle-orm";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { nowDate } from "@/lib/clock";
import type { AppDb, DbExecutor } from "./client";
import { people, personCourtesyEmailUnsubscribeTokens, shops } from "./schema";

/**
 * Mints a fresh, non-expiring bearer link opting one person out of courtesy
 * email — `waitlist_invite` and `trip_recap` (Leo — self-serve email
 * unsubscribe). Called once per send, alongside `inviteWaitlistDiver` /
 * `sendDueRecaps`, mirroring `issueLastMinuteListUnsubscribeToken`: every
 * courtesy email carries its own working link even if an earlier one is later
 * relied on too, and the token never expires — an expired opt-out link would
 * leave someone unable to stop the emails, silently.
 */
export async function issuePersonCourtesyEmailUnsubscribeToken(
  db: AppDb,
  input: { shopId: string; personId: string },
): Promise<string> {
  const token = createBearerToken();
  await db.insert(personCourtesyEmailUnsubscribeTokens).values({
    shopId: input.shopId,
    personId: input.personId,
    tokenHash: hashBearerToken(token),
  });
  return token;
}

export type CourtesyEmailUnsubscribeContext = {
  shopId: string;
  shopName: string;
  personId: string;
  alreadyOptedOut: boolean;
};

/**
 * Resolves a bearer token to the person it names, or null for anything that
 * must read as "this link isn't available" — an unknown token or a
 * since-deleted shop. Deliberately does not treat an already-opted-out person
 * as invalid, the same reasoning as `resolveLastMinuteListUnsubscribeToken`:
 * a diver clicking an old email's link twice should see a real
 * "you're already unsubscribed" state, not a dead link.
 */
export async function resolveCourtesyEmailUnsubscribeToken(
  db: DbExecutor,
  token: string,
): Promise<CourtesyEmailUnsubscribeContext | null> {
  const [row] = await db
    .select({
      tokenShopId: personCourtesyEmailUnsubscribeTokens.shopId,
      personShopId: people.shopId,
      shopName: shops.name,
      personId: people.id,
      courtesyEmailOptOutAt: people.courtesyEmailOptOutAt,
    })
    .from(personCourtesyEmailUnsubscribeTokens)
    .innerJoin(people, eq(people.id, personCourtesyEmailUnsubscribeTokens.personId))
    .innerJoin(shops, eq(shops.id, people.shopId))
    .where(eq(personCourtesyEmailUnsubscribeTokens.tokenHash, hashBearerToken(token)))
    .limit(1);
  if (!row) return null;
  // Defense in depth, mirroring `resolveLastMinuteListUnsubscribeToken`: nothing
  // legitimate can cause the token's own shopId to drift from its person's, but
  // a resolved identity must never be trusted past that check.
  if (row.tokenShopId !== row.personShopId) return null;
  return {
    shopId: row.personShopId,
    shopName: row.shopName,
    personId: row.personId,
    alreadyOptedOut: row.courtesyEmailOptOutAt !== null,
  };
}

/**
 * The one mutating step a diver's own unsubscribe click drives: resolves the
 * token, then opts the person it names out of courtesy email. Idempotent — a
 * token clicked twice just confirms the same outcome rather than erroring.
 */
export async function optOutPersonFromCourtesyEmailByToken(
  db: AppDb,
  input: { token: string; now?: Date },
): Promise<CourtesyEmailUnsubscribeContext | null> {
  const context = await resolveCourtesyEmailUnsubscribeToken(db, input.token);
  if (!context) return null;
  await db
    .update(people)
    .set({ courtesyEmailOptOutAt: input.now ?? nowDate() })
    .where(eq(people.id, context.personId));
  return context;
}
