"use server";

import { APIError } from "better-auth/api";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import type { DbExecutor } from "@/db/client";
import { getDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";
import { createDemoShop, resetDemoSchedule } from "@/db/seed";
import { getShopById, getShopBySlug } from "@/db/shops";
import { auth, getAuth } from "@/lib/auth";
import { DEMO_BYPASS_PASSWORD } from "@/lib/credentials";
import type { DemoRoleId } from "@/lib/demo-roles";
import { eventSource } from "@/lib/funnel";
import { publicSchedulePath } from "@/lib/public-routes";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { requireStaffSession } from "@/lib/session";
// A plain module, deliberately not a second server action — see its own file
// comment: exporting it from here would publish it as an unauthenticated
// endpoint taking a caller-supplied shop slug.
import { announceDemoEntry } from "./demo-instrumentation";

const ENTERABLE_DEMO_ROLES = new Set<DemoRoleId>([
  "owner",
  "instructor",
  "divemaster",
  "captain",
  "diver",
]);

/**
 * Everything `switchDemoRoleAction` will look at — the enterable roles plus
 * `manager`, which the switcher offers and which resolves to the shop's owner.
 *
 * The action takes its `role` as a plain string from the caller and used to
 * cast it straight into `eq(personRoles.role, …)`. Anything outside the
 * `person_role` enum then reached Postgres as an invalid enum literal: a
 * driver error, an unhandled rejection, and a 500 out of an action that needs
 * no session at all. Checked membership first, refused the way the action
 * already handles a role nobody in the shop holds.
 */
const SWITCHABLE_DEMO_ROLES = new Set<string>([
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "diver",
]);

/**
 * A demo form submits a `source` tag and, from the in-demo role switcher, a
 * `role`; a marketing-page CTA sends only the tag, which defaults here to the
 * owner view it has always opened on.
 */
function requestedDemoRole(formData?: FormData): DemoRoleId {
  const raw = formData?.get("role");
  return typeof raw === "string" && ENTERABLE_DEMO_ROLES.has(raw as DemoRoleId)
    ? (raw as DemoRoleId)
    : "owner";
}

/**
 * Who holds a role in a shop, looked up by role rather than a hardcoded seed
 * email — works on any seeded demo tenant (the canonical fixture or a minted
 * one). Shared by the landing page's pre-entry role picker and the in-app
 * role switcher (`switchDemoRoleAction` below).
 */
async function findDemoRoleEmail(
  db: DbExecutor,
  shopId: string,
  role: "owner" | "instructor" | "divemaster" | "captain",
): Promise<string | null> {
  const matches = await db
    .select({ email: people.email })
    .from(people)
    .innerJoin(personRoles, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, role)))
    .limit(1);
  return matches[0]?.email ?? null;
}

/**
 * One-click into the demo: mint a fresh, disposable demo shop with a generated
 * identity, then sign the visitor in and land on the view their role picked
 * (`role`, one of `DemoRoleId` — owner when the form sends none, the primary
 * CTA's long-standing behavior). Each visitor gets their own throwaway shop
 * rather than sharing the canonical fixture (ADR 20260724-per-visitor-demo-shops);
 * a 7-day reaper clears them. Forms may carry a hidden `source` field naming
 * the page the click came from.
 */
export async function enterDemoAction(formData?: FormData) {
  const role = requestedDemoRole(formData);
  const source = eventSource(formData?.get("source"));

  // Each demo mints a whole seeded shop, so throttle per IP — the reaper bounds
  // total growth, this bounds the burst one visitor can drive.
  const ip = await clientIp();
  if (!(await checkRateLimit(rateLimitKey("demo-create", ip), RATE_LIMITS.demoCreate)).allowed) {
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

  // Only now is the demo *entered*: the mint succeeded and this visitor has a
  // shop to look at. Counting it at the top of the action instead — where it
  // used to be — booked a throttled visitor and a failed mint as entries, which
  // is the one thing a funnel number must never do (it inflates the numerator
  // of every demo-to-trial ratio read off it). Deferred with after() for the
  // same reason the trial half is (src/app/onboard/actions.ts): a redirect the
  // visitor is waiting on must not queue behind a telemetry or mail round trip.
  after(() => announceDemoEntry({ slug, role, source }));

  // The diver pick previews the customer view — the public schedule needs no
  // sign-in at all, so it skips straight there instead of minting a session.
  if (role === "diver") {
    redirect(publicSchedulePath(slug));
  }

  let targetEmail = ownerEmail;
  if (role !== "owner") {
    const shop = await getShopBySlug(db, slug);
    // Every minted demo seeds exactly one instructor, divemaster, and captain
    // (src/db/seed.ts), so this always resolves in practice; the owner
    // fallback just means a picker click can never dead-end even if that changes.
    targetEmail = (shop ? await findDemoRoleEmail(db, shop.id, role) : null) ?? ownerEmail;
  }

  try {
    const auth = await getAuth();
    await auth.api.signInDiveDayCredentials({
      body: { email: targetEmail, password: DEMO_BYPASS_PASSWORD },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError) redirect("/sign-in?error=1");
    throw error; // unexpected errors propagate
  }
  redirect(`/shop/${slug}`);
}

export async function resetDemoAction() {
  const session = await requireStaffSession();
  const db = await getDb();
  const shop = await getShopById(db, session.user.shopId);
  if (shop?.isDemo) {
    await resetDemoSchedule(db, shop.id, { history: true });
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

  // A role this app has never heard of is the same non-event as a role nobody
  // in this shop holds: back to the shop, no query, no error page. It must not
  // become a Postgres enum error below (see `SWITCHABLE_DEMO_ROLES`).
  if (!SWITCHABLE_DEMO_ROLES.has(role)) redirect(`/shop/${shopSlug}`);

  if (role === "diver") {
    const session = await auth();
    if (session) {
      try {
        const instance = await getAuth();
        await instance.api.signOut({ headers: await headers() });
      } catch (error) {
        if (error instanceof APIError) {
          redirect(publicSchedulePath(shopSlug));
        }
        throw error;
      }
    }
    // Nobody was signed in, so there was nothing to sign out of — an ordinary
    // navigation, and deliberately *outside* the `try`. `redirect()` unwinds by
    // throwing, and the `catch` above sorts throws by shape (`instanceof
    // APIError`): a redirect written inside was a refusal handed to error
    // handling that never asked for it. One edit to that catch and the diver
    // preview would have gone nowhere, silently (scripts/check-redirect-in-try.mjs).
    redirect(publicSchedulePath(shopSlug));
  } else {
    // Look the target person up by their role *within this shop* rather than by
    // hardcoded seed emails, so role-switching works on any seeded demo tenant
    // (not just Blue Mantis). owner/manager both resolve to the shop's owner.
    const lookupRole = (role === "owner" || role === "manager" ? "owner" : role) as
      | "owner"
      | "instructor"
      | "divemaster"
      | "captain";
    const targetEmail = await findDemoRoleEmail(db, shop.id, lookupRole);

    if (!targetEmail) {
      // No seeded person holds this role in this shop — no-op back to the shop
      // rather than failing a sign-in. (The banner also hides absent roles.)
      redirect(`/shop/${shopSlug}`);
    }

    try {
      const auth = await getAuth();
      await auth.api.signInDiveDayCredentials({
        body: { email: targetEmail, password: DEMO_BYPASS_PASSWORD },
        headers: await headers(),
      });
    } catch (error) {
      if (error instanceof APIError) {
        redirect(`/shop/${shopSlug}?error=switch_failed`);
      }
      throw error;
    }
    redirect(`/shop/${shopSlug}`);
  }
}
