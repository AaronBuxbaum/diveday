"use server";

import { APIError } from "better-auth/api";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { issueAccountToken } from "@/db/account-tokens";
import { getDb } from "@/db/client";
import { createFirstDay } from "@/db/first-day";
import { sendNotification } from "@/db/notifications";
import { createSignedUpShop, type ShopSignupOutcome } from "@/db/shop-signup";
import { toDiverLocale } from "@/i18n/settings";
import { verifyAccountLinkPath } from "@/lib/account-tokens";
import { getAuth } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { isDemoAccountEmail } from "@/lib/demo-identity";
import { parseFirstDayFields } from "@/lib/first-day";
import { parseForm } from "@/lib/form-parse";
import { log } from "@/lib/log";
import { publicAppUrl } from "@/lib/notifications";
import { onboardSchema } from "@/lib/onboarding";
import { alertRecipient } from "@/lib/platform-mail";
import { checkRateLimit, RATE_LIMIT_MESSAGE, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  isSetupLinkTokenShape,
  SETUP_LINK_COOKIE,
  SETUP_LINK_COOKIE_MAX_AGE_S,
  SETUP_LINK_PARAM,
} from "@/lib/setup-links";

/**
 * The fields read before the schema is (issue #2233): the setup link, judged
 * by its shape, the two first-day fields, judged by `parseFirstDayFields`, and
 * the ones a bounce echoes. `unknown`, because each of those judges takes
 * whatever a crafted post put in the box and is the one place that decides;
 * this envelope never refuses.
 */
const onboardEnvelope = z.object({
  [SETUP_LINK_PARAM]: z.unknown().optional(),
  boat: z.unknown().optional(),
  departure: z.unknown().optional(),
  shopName: z.unknown().optional(),
  shopSlug: z.unknown().optional(),
  timezone: z.unknown().optional(),
  ownerName: z.unknown().optional(),
});

export async function onboardAction(formData: FormData) {
  // Preserve selected fields in the bounce; email and password are omitted, and the bearer token
  // stays in its HttpOnly cookie.
  const PRESERVED_FIELDS = ["shopName", "shopSlug", "timezone", "ownerName"] as const;
  // This action is callable without visiting the gated page. Reject malformed token shapes
  // before any bounce; createSignedUpShop verifies and spends a live token atomically with shop
  // creation.
  const envelope = parseForm(onboardEnvelope, formData);
  const raw: z.infer<typeof onboardEnvelope> = envelope.ok ? envelope.data : {};
  const setupToken = raw[SETUP_LINK_PARAM];
  const tokenShaped = isSetupLinkTokenShape(setupToken);
  // Parse optional first-day values before validation because backToForm reflects them into the
  // redirect URL; invalid or oversized raw input must not be echoed.
  const firstDay = parseFirstDayFields({
    boat: raw.boat,
    departure: raw.departure,
  });
  // Explicit return type lets TypeScript treat the redirecting helper as never-returning.
  const backToForm: (message: string) => Promise<never> = async (message) => {
    if (!tokenShaped) redirect("/onboard");
    // Keep the bearer token out of the Location URL; setupLinkDoor reads it from this HttpOnly
    // cookie.
    (await cookies()).set(SETUP_LINK_COOKIE, setupToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/onboard",
      maxAge: SETUP_LINK_COOKIE_MAX_AGE_S,
    });
    const params = new URLSearchParams({ error: message });
    for (const field of PRESERVED_FIELDS) {
      const value = raw[field];
      if (typeof value === "string" && value) params.set(field, value);
    }
    if (firstDay.boatName) params.set("boat", firstDay.boatName);
    if (firstDay.departure) params.set("departure", firstDay.departure);
    redirect(`/onboard?${params.toString()}`);
  };

  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("onboard", ip), RATE_LIMITS.onboard)).allowed) {
    // The page maps these stable error codes to localized copy; this action returns no sentences.
    return await backToForm(RATE_LIMIT_MESSAGE);
  }

  // Rate-limit before refusing a missing or malformed link so those submissions are bounded too.
  if (!tokenShaped) redirect("/onboard");

  const parsed = parseForm(onboardSchema, formData);

  if (!parsed.ok) {
    // The schema emits stable codes; the page resolves them using the request's locale.
    const firstError = parsed.messages[0] || "invalid_input";
    return await backToForm(firstError);
  }

  const { shopName, shopSlug, timezone, ownerName, ownerEmail, ownerPassword } = parsed.data;

  // Keep reserved demo addresses out of real accounts: the demo sign-in bypass trusts this
  // namespace (ADR 20260803-demo-bypass-containment).
  if (isDemoAccountEmail(ownerEmail)) return await backToForm("email_reserved");

  const db = await getDb();
  let outcome: ShopSignupOutcome;
  try {
    outcome = await createSignedUpShop(db, {
      setupToken,
      shopName,
      shopSlug,
      timezone,
      ownerName,
      ownerEmail,
      ownerPassword,
    });
  } catch (err) {
    // Log only the exception type; never expose database/provider details to an unauthenticated
    // visitor (CR-014).
    log("onboard.create_shop_failed", "error", {
      errorCode: err instanceof Error ? err.name : "unknown_error",
    });
    return await backToForm("create_failed");
  }
  // Keep outside the catch: backToForm redirects by throwing, which must not become create_failed.
  if (!outcome.ok) return await backToForm(outcome.reason);
  const createdShop = outcome.shop;
  const newAccountId = outcome.accountId;
  const newShopId = createdShop.id;
  const newShopLocale = createdShop.defaultLocale;

  // Await the optional first-day write so Today is ready on arrival; failures are logged but
  // cannot undo the shop/account already committed.
  if (createdShop && firstDay.boatName && firstDay.departure) {
    try {
      await createFirstDay(db, createdShop, {
        boatName: firstDay.boatName,
        departure: firstDay.departure,
        now: nowDate(),
      });
    } catch (error) {
      log("onboard.first_departure_failed", "error", {
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }

  // Owner email is best-effort and needs a valid canonical origin; APP_HOST may override
  // `https://dive.day`. Defer it so provider latency cannot delay the redirect (ADR
  // 20260725-account-lifecycle-emails).
  if (newAccountId && newShopId) {
    const accountId = newAccountId;
    const shopId = newShopId;
    const locale = toDiverLocale(newShopLocale);

    // Founder alert has no URL dependency and runs even when APP_HOST is unset.
    //
    // Catch getDb() and sendNotification together: awaiting getDb() as an argument can reject
    // before a trailing .catch is attached.
    after(async () => {
      try {
        await sendNotification(await getDb(), {
          kind: "operator_alert",
          event: "new_account",
          userAccountId: accountId,
          shopId,
          to: alertRecipient(),
          ownerName,
          ownerEmail: ownerEmail.toLowerCase(),
          shopName,
          shopSlug,
          ...(createdShop.nameFlaggedAt ? { nameFlagged: true as const } : {}),
        });
      } catch (error) {
        log("onboard.new_account_alert_failed", "error", {
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
      }
    });

    const origin = publicAppUrl();
    if (origin) {
      after(async () => {
        const issued = await issueAccountToken(db, {
          userAccountId: accountId,
          purpose: "email_verification",
        }).catch((error: unknown) => {
          // Log token-issuance failure; the welcome may still send, but verification cannot.
          log("onboard.verification_token_failed", "error", {
            errorCode: error instanceof Error ? error.name : "unknown_error",
          });
          return null;
        });
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
            kind: "address_confirmation",
            purpose: "account",
            userAccountId: accountId,
            tokenId: issued.tokenId,
            shopId,
            to: ownerEmail.toLowerCase(),
            locale,
            ownerName,
            confirmUrl: new URL(verifyAccountLinkPath(issued.token), `${origin}/`).toString(),
            expiresAt: issued.expiresAt,
            timezone,
          }).catch(() => ({ status: "failed" as const }));
        }
      });
    }
  }

  // Sign in the new owner, then redirect to the shop.
  let pendingSignIn = false;
  try {
    const auth = await getAuth();
    const signedIn = await auth.api.signInDiveDayCredentials({
      body: { email: ownerEmail.toLowerCase(), password: ownerPassword },
      headers: await headers(),
    });
    pendingSignIn = signedIn.pending;
  } catch (error) {
    if (error instanceof APIError) {
      return await backToForm("signin_failed");
    }
    throw error;
  }
  if (pendingSignIn) redirect("/sign-in?error=two-factor");
  // Clear the bounce cookie after successful creation; its link has been spent.
  (await cookies()).delete(SETUP_LINK_COOKIE);
  redirect(`/shop/${shopSlug}`);
}
