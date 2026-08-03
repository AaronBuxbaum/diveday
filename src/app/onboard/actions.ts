"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { AuthError } from "next-auth";
import { issueAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { people, personRoles, shops, userAccounts, waiverTemplates } from "@/db/schema";
import { toDiverLocale } from "@/i18n/settings";
import { verifyAccountLinkPath } from "@/lib/account-tokens";
import { trackEvent } from "@/lib/analytics";
import { signIn } from "@/lib/auth";
import { eventSource } from "@/lib/funnel";
import { publicAppUrl } from "@/lib/notifications";
import { onboardSchema } from "@/lib/onboarding";
import { hashPassword } from "@/lib/password-hashing";
import { ALERT_EMAIL } from "@/lib/platform-mail";
import { checkRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { DEFAULT_WAIVER_BODY, DEFAULT_WAIVER_TITLE } from "@/lib/waivers";

export async function onboardAction(formData: FormData) {
  // Which marketing page's "Start a trial" sent them here, carried by the form
  // and preserved across every bounce back to it so a retry doesn't lose the
  // attribution the funnel event reads.
  const source = eventSource(formData.get("source"));
  // Non-secret fields only — never the password — echoed back so a bounce to
  // `?error=` doesn't wipe a form a shop owner just spent a minute filling in.
  const PRESERVED_FIELDS = ["shopName", "shopSlug", "timezone", "ownerName", "ownerEmail"] as const;
  // Annotated so TypeScript treats the call as never-returning (control-flow
  // analysis only honours that on an explicitly typed const).
  const backToForm: (message: string) => never = (message) => {
    const params = new URLSearchParams({ error: message });
    if (source !== "unknown") params.set("from", source);
    for (const field of PRESERVED_FIELDS) {
      const value = formData.get(field);
      if (typeof value === "string" && value) params.set(field, value);
    }
    redirect(`/onboard?${params.toString()}`);
  };

  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("onboard", ip), RATE_LIMITS.onboard)).allowed) {
    // A code, like every other `backToForm` call below — OnboardPage resolves
    // every code through ONBOARD_ERROR_MESSAGES into the visitor's own
    // language. No sentence leaves this action in any path.
    backToForm(RATE_LIMIT_MESSAGE);
  }

  const rawData = Object.fromEntries(formData.entries());
  const parsed = onboardSchema.safeParse(rawData);

  if (!parsed.success) {
    // `onboardSchema`'s `.min()`/`.regex()`/`.refine()` messages are codes,
    // not sentences (src/lib/onboarding.ts) — Zod wants a message at
    // schema-definition time, before any request-scoped locale is known.
    const firstError = parsed.error.issues[0]?.message || "invalid_input";
    backToForm(firstError);
  }

  const { shopName, shopSlug, timezone, ownerName, ownerEmail, ownerPassword } = parsed.data;

  const db = await getDb();
  let onboardingError: string | null = null;
  let newAccountId: string | null = null;
  let newShopId: string | null = null;
  let newShopLocale: string | null = null;

  try {
    await db.transaction(async (tx) => {
      // Check if slug is taken
      const [existingShop] = await tx.select().from(shops).where(eq(shops.slug, shopSlug)).limit(1);

      if (existingShop) {
        onboardingError = "shop_slug_taken";
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
        onboardingError = "email_taken";
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
      newShopLocale = newShop.defaultLocale;

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

      const hashedPassword = await hashPassword(ownerPassword);

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
      backToForm(onboardingError);
    }
    // Never surface a raw exception to an unauthenticated visitor — it can
    // carry internal detail (a DB driver error, a stack fragment). The real
    // cause goes to the server log, where the shop's technical owner can see
    // it; the visitor gets a generic, actionable message (CR-014).
    console.error("onboardAction: failed to create shop", err);
    backToForm("create_failed");
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
    const locale = toDiverLocale(newShopLocale);

    // The trial half of the marketing funnel: `demo_entered` counts the skeptics
    // who look, this counts the ones who committed to a shop, both tagged with
    // the page that sent them. Deferred like the mail below — telemetry never
    // delays the response the new owner is waiting on.
    after(() => trackEvent({ name: "trial_started", source }));

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
          locale,
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
            locale,
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
      backToForm("signin_failed");
    }
    throw error; // Propagate NEXT_REDIRECT
  }
}
