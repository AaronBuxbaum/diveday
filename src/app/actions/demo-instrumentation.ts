import { getDb } from "@/db/client";
import { sendNotification } from "@/db/notifications";
import { getShopBySlug } from "@/db/shops";
import { trackEvent } from "@/lib/analytics";
import type { DemoRoleId } from "@/lib/demo-roles";
import type { FunnelSource } from "@/lib/funnel";
import { alertRecipient } from "@/lib/platform-mail";

/**
 * What DiveDay records when somebody tries the live demo: the typed funnel
 * event, and the founder's alert mail (docs ADR 20260805-demo-try-alerts).
 *
 * **This file has no `"use server"` directive, and must not gain one.** It sits
 * beside `demo.ts` rather than inside it for exactly that reason: every
 * exported async function in a `"use server"` module is a callable server-action
 * endpoint, and `enterDemoAction`'s module is reachable by anyone — the demo CTA
 * needs no session at all. Exported from there, this function would be an
 * unauthenticated endpoint accepting a caller-supplied slug, role, and source,
 * which is enough to spray junk tags into the funnel, mail the founder about
 * demo tries that never happened, and — by passing a *real* shop's slug — write
 * a poisoned payload into that tenant's `notification_send_queue`. Types are
 * erased at runtime and would not have stopped any of it. As a plain module it
 * is reachable only from server code that imports it. (Same reason
 * `seat-diver-surfaces.ts` is a plain sibling of `seat-diver.ts`.)
 */

/**
 * Announce one demo entry, best-effort.
 *
 * **Every failure in here is swallowed.** It runs inside `after()`, so a throw
 * would surface as an unhandled rejection long after the visitor is already in
 * their demo, and nothing it does is worth a single lost entry. Telemetry and
 * alerting observe this flow; they are never part of it.
 *
 * Nothing personal crosses either boundary, because nothing personal exists to
 * cross it: a demo visitor has no session, no account, and typed nothing. The
 * three values carried out are the throwaway shop's slug, the role button
 * pressed, and a funnel tag the caller has already clamped to the closed
 * `FunnelSource` registry.
 */
export async function announceDemoEntry(input: {
  slug: string;
  role: DemoRoleId;
  source: FunnelSource | "unknown";
}): Promise<void> {
  const { slug, role, source } = input;

  // Two independent observers, two independent guards — never one try block
  // around both. `trackEvent` already swallows its own provider failures, so
  // this catch looks redundant; sharing a block with the alert is what makes
  // it not. A throw escaping the analytics seam would skip the founder's mail
  // entirely, which is the failure mode least likely to be noticed: the inbox
  // goes quiet and nothing anywhere says why.
  try {
    await trackEvent({ name: "demo_entered", source, role });
  } catch (error) {
    console.error("announceDemoEntry: demo_entered event failed", error);
  }

  try {
    const db = await getDb();
    // The alert needs the minted shop's row id: `notification_send_queue` FKs
    // to it, which is what lets a retryable failure be durable and what lets
    // the 7-day reaper clear the row along with the shop it belongs to.
    const shop = await getShopBySlug(db, slug);
    if (!shop) return;
    await sendNotification(db, {
      kind: "demo_started_alert",
      shopId: shop.id,
      to: alertRecipient(),
      shopSlug: slug,
      role,
      source,
    });
  } catch (error) {
    console.error("announceDemoEntry: demo alert failed", error);
  }
}
