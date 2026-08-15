"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import {
  type FeedScope,
  feedPath,
  feedSubscribeUrl,
  issueCalendarFeed,
  revokeCalendarFeeds,
} from "@/features/calendar-sync";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import type { FeedIssueState } from "./feed-panel-types";

function scopeFromFormData(formData: FormData): FeedScope | null {
  const scope = formData.get("scope");
  return scope === "assignments" || scope === "shop_trips" ? scope : null;
}

/**
 * The origin this app is being served from, for building a subscribe URL the
 * staff member can paste into a calendar client. Read from the request rather
 * than an env var so a preview deployment hands out its own origin.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  // Loopback covers `pnpm dev` and the e2e fleet, which serve plain http; a
  // proxy in front of a real deployment sets x-forwarded-proto. Matching only
  // the literal "localhost" would hand a `https://127.0.0.1:3000` URL to
  // anyone running on the IP form, which no calendar client can fetch.
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol = headerList.get("x-forwarded-proto") ?? (loopback ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * The panel's single mutation, dispatched on `intent`.
 *
 * One action rather than two because the panel drives it through one
 * `useActionState`: with a hook per action there is no way to tell which ran
 * most recently, so a revoke followed by a create left the panel rendering the
 * revoked state over a live subscription.
 *
 * Two other deliberate choices. The scope is the only thing the form controls —
 * whose calendar this is comes from the session, so no request can mint a
 * credential over someone else's schedule. And the raw token comes back in the
 * action's *return value* rather than a redirect query param: it is a
 * long-lived bearer credential, and a URL would put it in browser history, the
 * referrer of the next outbound click, and any proxy log in between.
 */
export async function calendarFeedAction(
  _previous: FeedIssueState,
  formData: FormData,
): Promise<FeedIssueState> {
  const session = await requireStaffSession();
  const scope = scopeFromFormData(formData);
  if (!scope) return { status: "denied" };

  const db = await getDb();
  const path = shopPath(session.user.shopSlug, "settings", "calendar");

  if (formData.get("intent") === "revoke") {
    await revokeCalendarFeeds(db, {
      shopId: session.user.shopId,
      personId: session.user.personId,
      scope,
    });
    revalidatePath(path);
    return { status: "revoked", scope };
  }

  const issued = await issueCalendarFeed(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    scope,
  });
  if (!issued) return { status: "denied" };

  const origin = await requestOrigin();
  revalidatePath(path);
  return {
    status: "issued",
    scope,
    webcalUrl: feedSubscribeUrl(origin, issued.token),
    httpsUrl: `${origin}${feedPath(issued.token)}`,
    rotated: formData.get("rotating") === "true",
  };
}
