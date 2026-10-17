import { eq } from "drizzle-orm";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { shopDefaultsForTimeZone } from "@/lib/curated-defaults";
import { hashPassword } from "@/lib/password-hashing";
import { shopNameNeedsReview } from "@/lib/shop-name-review";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";
import type { AppDb } from "./client";
import {
  people,
  personRoles,
  preDepartureChecklistItems,
  shops,
  userAccounts,
  waiverTemplates,
} from "./schema";
import { recordSetupLinkShop, spendSetupLink } from "./setup-links";

export type ShopSignup = {
  setupToken: unknown;
  shopName: string;
  shopSlug: string;
  timezone: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
};

export type ShopSignupRefusal = "setup_link_closed" | "shop_slug_taken" | "email_taken";

export type ShopSignupOutcome =
  | { ok: true; shop: typeof shops.$inferSelect; accountId: string }
  | { ok: false; reason: ShopSignupRefusal };

/** Thrown inside the transaction to roll it back with a code the caller reads. */
class SignupRefused extends Error {
  constructor(readonly reason: ShopSignupRefusal) {
    super(reason);
  }
}

/**
 * A real shop and its owner, in one transaction: the setup link spent, the
 * shop, the owner's person with the owner and manager roles, the sign-in
 * account, the default waiver and the first pre-departure line. Any refusal rolls every write back,
 * including the spend, so the corrected form can use the same link.
 *
 * Moved out of `src/app/onboard/actions.ts` so the route builds no query of
 * its own (`check:architecture`).
 */
export async function createSignedUpShop(
  db: AppDb,
  signup: ShopSignup,
): Promise<ShopSignupOutcome> {
  const email = signup.ownerEmail.toLowerCase();
  try {
    return await db.transaction(async (tx) => {
      // Spend the link first: the conditional update is the claim, so of two
      // submissions racing on one link exactly one gets past here, and any
      // refusal below rolls the spend back with everything else, leaving the
      // link open for the corrected form.
      if (!(await spendSetupLink(tx, signup.setupToken))) {
        throw new SignupRefused("setup_link_closed");
      }

      const [existingShop] = await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.slug, signup.shopSlug))
        .limit(1);
      if (existingShop) throw new SignupRefused("shop_slug_taken");

      const [existingAccount] = await tx
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(eq(userAccounts.email, email))
        .limit(1);
      if (existingAccount) throw new SignupRefused("email_taken");

      const [shop] = await tx
        .insert(shops)
        .values({
          name: signup.shopName,
          // A name that could pass for a brand or an institution is held for
          // review: its mail goes out as plain DiveDay until a human clears it
          // (issue #2450). The shop is created and can send either way.
          nameFlaggedAt: shopNameNeedsReview(signup.shopName) ? nowDate() : null,
          slug: signup.shopSlug,
          timezone: signup.timezone,
          // **The timezone already answered these.** A shop that just said
          // `America/Cancun` was created pricing in dollars, and a Florida shop
          // — where every briefing says 60 ft — was as likely to get metres
          // (issue #712). Derived, not assumed: the setup checklist asks the
          // shop to confirm both, because a default nobody looked at is the
          // same failure with extra steps. A zone outside the curated
          // shortcuts falls back to today's defaults, unchanged.
          ...shopDefaultsForTimeZone(signup.timezone),
          // A real shop is never seeded and is never a demo. Sample/fake data
          // lives only in a freshly-minted demo shop (createDemoShop), so a shop
          // that later imports its real roster never has seeded rows mixed in.
          // See ADR 20260724-per-visitor-demo-shops.
          isDemo: false,
          // Explicit rather than the column's DB-side `defaultNow()`: this is
          // the instant the trial clock in src/lib/trial.ts counts from, read
          // back and shown to the owner, so it has to be the same clock every
          // other render uses (src/lib/clock.ts) — under the e2e/visual
          // harness that's the one frozen instant, not the database engine's
          // own wall clock, which would otherwise drift the trial-days-left
          // math on every run.
          createdAt: nowDate(),
        })
        .returning();
      if (!shop) throw new Error("Failed to create shop");
      await recordSetupLinkShop(tx, String(signup.setupToken), shop.id);

      const [person] = await tx
        .insert(people)
        .values({
          shopId: shop.id,
          fullName: signup.ownerName,
          email,
          // No placeholder emergency contact: a literal "On file" reads as a real
          // contact on the manifest and hides the gap. Left null until captured.
        })
        .returning({ id: people.id });
      if (!person) throw new Error("Failed to create owner person");

      await tx.insert(personRoles).values([
        { personId: person.id, role: "owner" },
        { personId: person.id, role: "manager" },
      ]);

      const [account] = await tx
        .insert(userAccounts)
        .values({
          personId: person.id,
          email,
          hashedPassword: await hashPassword(signup.ownerPassword),
        })
        .returning({ id: userAccounts.id });
      if (!account) throw new Error("Failed to create user account");

      // Every new shop starts clean: just its default waiver, ready for the
      // owner's own trips and divers. No sample data — that only ever lives in
      // a demo shop (ADR 20260724-per-visitor-demo-shops).
      //
      // The default is published as version 1, so divers can sign it the hour
      // the shop goes live. Until the shop publishes its own words the
      // first-run checklist keeps "Read your release" open and the Waivers
      // page says the text is sample wording (`isSampleRelease`).
      await tx.insert(waiverTemplates).values({
        shopId: shop.id,
        title: DEFAULT_WAIVER_TITLE,
        version: 1,
        body: DEFAULT_WAIVER_BODY,
      });

      // **Oxygen is asked about from the first departure** (#2301, Aaron
      // 2026-10-13): the one pre-departure line DiveDay writes, in the shop's
      // own language. Kit moves between hulls and the register assigns it to
      // one boat, so the crew confirm it per departure instead. It is an
      // ordinary line from here: the shop may reword or delete it, and it
      // informs, never gates (ADR 20260824-pre-departure-safety-check).
      await tx.insert(preDepartureChecklistItems).values({
        shopId: shop.id,
        label: staffTranslator(shop.defaultLocale)("settings.safetyChecklist.defaultLine"),
        sortOrder: 0,
      });

      return { ok: true as const, shop, accountId: account.id };
    });
  } catch (error) {
    if (error instanceof SignupRefused) return { ok: false, reason: error.reason };
    throw error;
  }
}
