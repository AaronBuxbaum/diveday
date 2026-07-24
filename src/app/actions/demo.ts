"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "@/db/dev-credentials";
import { people, personRoles } from "@/db/schema";
import { resetDemoSchedule } from "@/db/seed";
import { getShopById, getShopBySlug } from "@/db/shops";
import { trackEvent } from "@/lib/analytics";
import { auth, signIn, signOut } from "@/lib/auth";
import { requireStaffSession } from "@/lib/session";

/**
 * One-click into the demo: sign in as the example shop's owner and land on the
 * staff dashboard. Database initialization guarantees the demo shop and login
 * exist before this action can run. Forms may carry a hidden `source` field
 * naming the page the click came from.
 */
export async function enterDemoAction(formData?: FormData) {
  const sourceField = formData?.get("source");
  await trackEvent({
    name: "demo_entered",
    source: typeof sourceField === "string" && sourceField !== "" ? sourceField : "unknown",
  });
  try {
    await signIn("credentials", {
      email: DEV_STAFF_LOGINS.owner.email,
      password: DEV_STAFF_LOGINS.owner.password,
      redirectTo: `/shop/${DEMO_SHOP_SLUG}`,
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
        password: "demo-role-switcher-bypass-token",
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
