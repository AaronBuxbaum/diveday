"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db/client";
import { issueDisplayToken, revokeDisplayToken } from "@/db/display-tokens";
import { boardPath } from "@/lib/display-tokens";
import { requireStaffSession } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import type { DisplayLinkState } from "./display-panel-types";

/**
 * The origin this app is served from, for the URL a staffer pastes into a
 * TV's browser. Read from the request rather than an env var so a preview
 * deployment hands out its own origin — the same reasoning as the calendar
 * feed's `requestOrigin`.
 */
async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol = headerList.get("x-forwarded-proto") ?? (loopback ? "http" : "https");
  return `${protocol}://${host}`;
}

/**
 * The panel's single mutation, dispatched on `intent` — one action for the
 * same reason the calendar panel has one: two `useActionState` hooks cannot
 * say which ran last.
 *
 * Whose shop this is comes from the session, never the form, and the raw
 * token comes back in the action's return value rather than a redirect
 * query: it is a long-lived bearer credential, and a URL would put it in
 * browser history and every proxy log between here and the TV. The store
 * re-derives the owner/manager gate itself (`issueDisplayToken`), so a
 * staffer who reaches this action through a stale page is refused there.
 */
export async function displayLinkAction(
  _previous: DisplayLinkState,
  formData: FormData,
): Promise<DisplayLinkState> {
  const session = await requireStaffSession();
  const db = await getDb();
  const path = shopPath(session.user.shopSlug, "settings", "display");

  if (formData.get("intent") === "revoke") {
    const id = formData.get("id");
    if (typeof id !== "string" || id.length === 0) return { status: "denied" };
    const revoked = await revokeDisplayToken(db, { shopId: session.user.shopId, id });
    revalidatePath(path);
    return revoked ? { status: "revoked", id } : { status: "denied" };
  }

  const outcome = await issueDisplayToken(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    label: formData.get("label"),
    showNames: formData.get("showNames") === "true",
  });
  if (!outcome.ok) {
    return outcome.reason === "invalid_label" ? { status: "invalid_label" } : { status: "denied" };
  }
  const origin = await requestOrigin();
  revalidatePath(path);
  return {
    status: "issued",
    id: outcome.issued.id,
    label: outcome.issued.label,
    url: `${origin}${boardPath(outcome.issued.token)}`,
  };
}
