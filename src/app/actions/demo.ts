"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";
import { createDemoShop, resetDemoSchedule } from "@/db/seed";
import { getShopById, getShopBySlug } from "@/db/shops";
import { trackEvent } from "@/lib/analytics";
import { auth, signIn, signOut } from "@/lib/auth";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { requireStaffSession } from "@/lib/session";

/**
 * The password any demo person signs in with: `credentials` accepts it for a
 * person in an `isDemo` shop without a real password match (src/lib/credentials.ts).
 * Reused here for the initial owner sign-in and, below, for role switching.
 */
const DEMO_BYPASS_PASSWORD = "demo-role-switcher-bypass-token";

/**
 * One-click into the demo: mint a fresh, disposable demo shop with a generated
 * identity, then sign the visitor in as its owner and land on the staff
 * dashboard. Each visitor gets their own throwaway shop rather than sharing the
 * canonical fixture (ADR 20260724-per-visitor-demo-shops); a 7-day reaper clears
 * them. Forms may carry a hidden `source` field naming the page the click came
 * from.
 */
export async function enterDemoAction(formData?: FormData) {
  const sourceField = formData?.get("source");
  await trackEvent({
    name: "demo_entered",
    source: typeof sourceField === "string" && sourceField !== "" ? sourceField : "unknown",
  });

  // Each demo mints a whole seeded shop, so throttle per IP — the reaper bounds
  // total growth, this bounds the burst one visitor can drive.
  const ip = await clientIp();
  if (!checkRateLimit(rateLimitKey("demo-create", ip), RATE_LIMITS.demoCreate).allowed) {
    redirect("/sign-in?error=1");
  }

  const db = await getDb();
  // Retry once on the astronomically-rare generated-slug/email collision
  // (23505) so it degrades to a fresh identity rather than a 500 (security
  // review, minor). createDemoShop never redirects, so nothing here swallows a
  // NEXT_REDIRECT.
  let minted: { slug: string; ownerEmail: string } | null = null;
  for (let attempt = 0; attempt < 2 && !minted; attempt++) {
    try {
      minted = await db.transaction(async (tx) => createDemoShop(tx));
    } catch (err) {
      const isUniqueViolation = (err as { code?: string } | null)?.code === "23505";
      if (attempt === 0 && isUniqueViolation) continue;
      throw err;
    }
  }
  if (!minted) redirect("/sign-in?error=1");
  const { slug, ownerEmail } = minted;

  try {
    await signIn("credentials", {
      email: ownerEmail,
      password: DEMO_BYPASS_PASSWORD,
      redirectTo: `/shop/${slug}`,
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/sign-in?error=1");
    throw error; // NEXT_REDIRECT (the success path) and unexpected errors propagate
  }
}

export async function resetDemoAction() {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (shop?.isDemo) {
    await resetDemoSchedule(db, shop.id);
  }
  redirect(`/shop/${session.user.shopSlug}?reset=1`);
}

/**
 * Switch the active session to a different demo role.
 * Works for both seeded and dynamically created trials.
 */
export async function switchDemoRoleAction(role: string, shopSlug: string) {
  const db = await getDb();
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop?.isDemo) redirect("/");

  if (role === "diver") {
    try {
      const session = await auth();
      if (session) {
        // Auth.js signOut will throw a redirect error to execute the redirect.
        await signOut({ redirectTo: `/shop/${shopSlug}/schedule` });
      } else {
        redirect(`/shop/${shopSlug}/schedule`);
      }
    } catch (error) {
      if (error instanceof AuthError) {
        redirect(`/shop/${shopSlug}/schedule`);
      }
      throw error; // NEXT_REDIRECT will propagate
    }
  } else {
    // Find the email for this role in the shop
    let targetEmail: string | null = null;

    // Look the target person up by their role *within this shop* rather than by
    // hardcoded seed emails, so role-switching works on any seeded demo tenant
    // (not just Blue Mantis). owner/manager both resolve to the shop's owner.
    const lookupRole = (role === "owner" || role === "manager" ? "owner" : role) as
      | "owner"
      | "instructor"
      | "divemaster"
      | "captain";
    const matches = await db
      .select({ email: people.email })
      .from(people)
      .innerJoin(personRoles, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, lookupRole)))
      .limit(1);
    targetEmail = matches[0]?.email ?? null;

    if (!targetEmail) {
      // No seeded person holds this role in this shop — no-op back to the shop
      // rather than failing a sign-in. (The banner also hides absent roles.)
      redirect(`/shop/${shopSlug}`);
    }

    try {
      await signIn("credentials", {
        email: targetEmail,
        password: DEMO_BYPASS_PASSWORD,
        redirectTo: `/shop/${shopSlug}`,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        redirect(`/shop/${shopSlug}?error=switch_failed`);
      }
      throw error; // NEXT_REDIRECT will propagate
    }
  }
}
