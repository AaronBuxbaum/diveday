import { and, eq, ne } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { bookings, people } from "./schema";

/**
 * **Three seats a hotel sent** — what the partner link in the embed catalogue
 * has always promised and nothing has ever shown (issue #1285).
 *
 * A shop hands a resort an attributed link (`partnerLinkUrl`,
 * src/lib/embed-snippets.ts); a diver arriving on it has the partner remembered
 * in a cookie at the edge, and their booking carries the slug. Without this the
 * whole path ships invisible: Reports renders nothing about partner arrivals
 * when nobody was credited, which is correct and also means the line has only
 * ever been seen in jsdom.
 *
 * **A column on seats that already exist**, exactly like `seed-dive-recency.ts`
 * and for the same reason: a referral is a fact about a booking, so seeding it
 * beside the demo rather than inside it would show a partner crediting nobody.
 * It is safe to write onto an asserted fixture because it **gates nothing** — no
 * head count moves, no readiness blocker reads it, no money changes. Reports'
 * five figures are identical either way; one quiet line appears beneath them.
 *
 * **Two partners, not one — and the report no longer says so.** Issue #1294
 * replaced the per-partner group with a count, because `partnerLinkUrl` writes
 * no row and nothing can tell a hotel's slug from one an anonymous visitor
 * invented. So the second partner no longer makes an ordering visible; what
 * these rows still earn is a non-zero number on the `reports` visual capture,
 * which is the only reason they are here now. Most of the demo's divers stay
 * unattributed, which is what a real shop's month looks like.
 *
 * Matched by email rather than by position, so re-ordering an earlier scenario
 * cannot silently move which seat carries which partner. A name that is not
 * there is skipped rather than thrown on: this is additive demo colour and must
 * never be the reason a shop fails to seed.
 */
const REFERRALS = [
  { email: "tom.okafor@example.com", partner: "coral-sands-resort" },
  { email: "priya.sharma@example.com", partner: "coral-sands-resort" },
  { email: "lena.fischer@example.com", partner: "harbour-house-inn" },
];

export async function seedPartnerReferrals(db: DbExecutor, shopId: string) {
  // Serial, never `Promise.all`: a drizzle transaction is one checked-out
  // client (`scripts/check-db-concurrency.mjs`).
  for (const referral of REFERRALS) {
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shopId), eq(people.email, referral.email)))
      .limit(1);
    if (!person) continue;
    await db
      .update(bookings)
      .set({ referralSource: referral.partner })
      .where(
        and(
          eq(bookings.shopId, shopId),
          eq(bookings.personId, person.id),
          ne(bookings.status, "cancelled"),
        ),
      );
  }
}
