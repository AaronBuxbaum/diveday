"use server";

import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AuthError } from "next-auth";
import { issueAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { people, personRoles, shops, userAccounts, waiverTemplates } from "@/db/schema";
import { verifyAccountLinkPath } from "@/lib/account-tokens";
import { signIn } from "@/lib/auth";
import { publicAppUrl } from "@/lib/notifications";
import { onboardSchema } from "@/lib/onboarding";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { checkRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

export async function onboardAction(formData: FormData) {
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("onboard", ip), RATE_LIMITS.onboard).allowed) {
    redirect(`/onboard?error=${encodeURIComponent(RATE_LIMIT_MESSAGE)}`);
  }

  const rawData = Object.fromEntries(formData.entries());
  const parsed = onboardSchema.safeParse(rawData);

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || "Invalid input";
    redirect(`/onboard?error=${encodeURIComponent(firstError)}`);
  }

  const { shopName, shopSlug, timezone, ownerName, ownerEmail, ownerPassword } = parsed.data;

  const db = await getDb();
  let onboardingError: string | null = null;
  let newAccountId: string | null = null;
  let newShopId: string | null = null;

  try {
    await db.transaction(async (tx) => {
      // Check if slug is taken
      const [existingShop] = await tx.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1);

      if (existingShop) {
        onboardingError = `The shop link "${shopSlug}" is already taken.`;
        tx.rollback();
        return;
      }

      // Check if email is taken
      const [existingAccount] = await tx
        .select()
        .from(userAccounts)
        .where(eq(userAccounts.email, ownerEmail.toLowerCase()))
        .limit(1);

      if (existingAccount) {
        onboardingError = "This email is already registered.";
        tx.rollback();
        return;
      }

      // Create Shop
      const [newShop] = await tx
        .insert(shops)
        .values({
          name: shopName,
          slug: shopSlug,
          timezone,
          // A real shop is never seeded and is never a demo. Sample/fake data
          // lives only in a freshly-minted demo shop (createDemoShop), so a shop
          // that later imports its real roster never has seeded rows mixed in.
          // See ADR 20260724-per-visitor-demo-shops.
          isDemo: false,
        })
        .returning();

      if (!newShop) {
        throw new Error("Failed to create shop");
      }
      newShopId = newShop.id;

      // Create owner person
      const [newPerson] = await tx
        .insert(people)
        .values({
          shopId: newShop.id,
          fullName: ownerName,
          email: ownerEmail.toLowerCase(),
          // No placeholder emergency contact: a literal "On file" reads as a real
          // contact on the manifest and hides the gap. Left null until captured.
        })
        .returning();

      if (!newPerson) {
        throw new Error("Failed to create owner person");
      }

      // Assign owner & manager roles
      await tx.insert(personRoles).values([
        { personId: newPerson.id, role: "owner" },
        { personId: newPerson.id, role: "manager" },
      ]);

      // Hash password (cost 10)
      const hashedPassword = await hash(ownerPassword, 10);

      // Create user account
      const [newAccount] = await tx
        .insert(userAccounts)
        .values({
          personId: newPerson.id,
          email: ownerEmail.toLowerCase(),
          hashedPassword,
        })
        .returning();

      if (!newAccount) {
        throw new Error("Failed to create user account");
      }
      newAccountId = newAccount.id;

      // Every new shop starts clean: just its default waiver, ready for the
      // owner's own trips and divers. No sample data — that only ever lives in
      // a demo shop (ADR 20260724-per-visitor-demo-shops).
      await tx.insert(waiverTemplates).values({
        shopId: newShop.id,
        title: DEFAULT_WAIVER_TITLE,
        version: 1,
        body: DEFAULT_WAIVER_BODY,
      });
    });
  } catch (err) {
    if (onboardingError) {
      redirect(`/onboard?error=${encodeURIComponent(onboardingError)}`);
    }
    // Never surface a raw exception to an unauthenticated visitor — it can
    // carry internal detail (a DB driver error, a stack fragment). The real
    // cause goes to the server log, where the shop's technical owner can see
    // it; the visitor gets a generic, actionable message (CR-014).
    console.error("onboardAction: failed to create shop", err);
    redirect(
      `/onboard?error=${encodeURIComponent("Something went wrong creating your shop. Please try again.")}`,
    );
  }

  // 2. Welcome + verify-email are best-effort — no working link exists
  // without a configured APP_HOST, and a failed send never blocks
  // onboarding either way (20260725-account-lifecycle-emails). Deferred with
  // after() rather than awaited: a slow or hanging Resend call must not risk
  // timing out the response the new owner is waiting on to reach their shop
  // (security review finding) — a real database write and network call have
  // no abort deadline otherwise.
  if (newAccountId && newShopId) {
    const accountId = newAccountId;
    const shopId = newShopId;

    // The founder alert needs no link, so it doesn't wait on APP_HOST being
    // configured the way the owner-facing mail below does.
    after(async () => {
      await sendNotification(await getDb(), {
        kind: "new_account_alert",
        userAccountId: accountId,
        shopId,
        to: ALERT_EMAIL,
        ownerName,
        ownerEmail: ownerEmail.toLowerCase(),
        shopName,
        shopSlug,
      }).catch(() => ({ status: "failed" as const }));
    });

    const origin = publicAppUrl();
    if (origin) {
      after(async () => {
        const issued = await issueAccountToken(db, {
          userAccountId: accountId,
          purpose: "email_verification",
        }).catch(() => null);
        await sendNotification(db, {
          kind: "welcome",
          userAccountId: accountId,
          shopId,
          to: ownerEmail.toLowerCase(),
          ownerName,
          shopName,
          signInUrl: new URL("/sign-in", `${origin}/`).toString(),
        }).catch(() => ({ status: "failed" as const }));
        if (issued) {
          await sendNotification(db, {
            kind: "email_verification",
            userAccountId: accountId,
            tokenId: issued.tokenId,
            shopId,
            to: ownerEmail.toLowerCase(),
            ownerName,
            verifyUrl: new URL(verifyAccountLinkPath(issued.token), `${origin}/`).toString(),
            expiresAt: issued.expiresAt,
            timezone,
          }).catch(() => ({ status: "failed" as const }));
        }
      });
    }
  }

  // 3. Sign in the new owner and redirect to dashboard
  try {
    await signIn("credentials", {
      email: ownerEmail.toLowerCase(),
      password: ownerPassword,
      redirectTo: `/shop/${shopSlug}`,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(
        `/onboard?error=${encodeURIComponent("Your shop was created, but signing you in failed. Try signing in below.")}`,
      );
    }
    throw error; // Propagate NEXT_REDIRECT
  }
}
