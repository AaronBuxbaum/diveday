"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { issueDisplayToken, revokeDisplayToken } from "@/db/display-tokens";
import { setShopPublicBoatLine, setShopYearOnDiveday } from "@/db/shops";
import { boardPath } from "@/lib/display-tokens";
import { kioskCheckInPath } from "@/lib/kiosk-check-in";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { DisplayLinkState } from "./display-panel-types";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * **Whether this shop's boats say where they are to somebody who is not
 * aboard** — ADR 20260908-one-hand, decision 6, lever U.
 *
 * Owner/manager work like every other row on this page, re-derived here from
 * live roles rather than trusted from the render that drew the checkbox: what
 * this switch turns on is a public page, and a staffer who reached this action
 * through a stale tab is refused at the write.
 */
export async function savePublicBoatLineAction(formData: FormData): Promise<void> {
  const session = await requireStaffSession();
  const db = await getDb();
  const path = shopPath(session.user.shopSlug, "settings", "display");
  const allowed = await canPersonManageShopSettings(db, session.user.shopId, session.user.personId);
  // The same refusal the page itself makes, and it throws rather than returns:
  // there is no path here that decides against the caller and carries on.
  if (!allowed) {
    redirect(noticeUrl(shopPath(session.user.shopSlug, "settings"), "settings-not-authorized"));
  }
  await setShopPublicBoatLine(db, session.user.shopId, formData.get("publicBoatLine") === "on");
  // The storefront and every boat's own page read this column, so the switch
  // has to reach past this pane.
  revalidatePath("/", "layout");
  revalidatePath(path);
}

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
    // A UUID or nothing: a malformed id is a refusal here, never a cast error
    // from the database.
    if (typeof id !== "string" || !UUID_SHAPE.test(id))
      return { status: "denied", intent: "revoke" };
    const revoked = await revokeDisplayToken(db, {
      shopId: session.user.shopId,
      personId: session.user.personId,
      id,
    });
    revalidatePath(path);
    return revoked ? { status: "revoked", id } : { status: "denied", intent: "revoke" };
  }

  // The form's radio, read as a closed set rather than trusted: `purpose`
  // decides whether the minted link opens a read-only screen or a surface that
  // records arrivals, so an unrecognised value must never fall through to the
  // more capable one.
  const purpose = formData.get("purpose") === "check_in" ? "check_in" : "board";
  const outcome = await issueDisplayToken(db, {
    shopId: session.user.shopId,
    personId: session.user.personId,
    label: formData.get("label"),
    purpose,
    showNames: formData.get("showNames") === "true",
  });
  if (!outcome.ok) {
    return outcome.reason === "invalid_label"
      ? { status: "invalid_label" }
      : { status: "denied", intent: "issue" };
  }
  const origin = await requestOrigin();
  revalidatePath(path);
  return {
    status: "issued",
    id: outcome.issued.id,
    label: outcome.issued.label,
    url: `${origin}${
      outcome.issued.purpose === "check_in"
        ? kioskCheckInPath(outcome.issued.token)
        : boardPath(outcome.issued.token)
    }`,
  };
}

/**
 * **The shop's yes** for its year on DiveDay's own pages (ADR
 * 20260908-one-hand, decision 6, lever T). One checkbox, off by default, and
 * the only thing that makes `/s/<slug>/year-card` exist at all.
 *
 * Owner/manager, like the rest of this page — what a shop shows the world is
 * shop policy — and the gate is re-derived here rather than trusted from the
 * page that rendered the form, so a staffer who reaches this action through a
 * stale tab is refused. A plain `<form action>` rather than the panel's
 * `useActionState`: this is one checkbox that redirects with its own outcome,
 * and it works before JavaScript.
 */
export async function saveYearOnDivedayAction(formData: FormData) {
  const session = await requireStaffSession();
  const db = await getDb();
  const path = shopPath(session.user.shopSlug, "settings", "display");
  const allowed = await canPersonManageShopSettings(db, session.user.shopId, session.user.personId);
  if (!allowed) redirect(noticeUrl(path, "display-not-authorized"));
  const on = formData.get("showYearOnDiveday") === "on";
  await setShopYearOnDiveday(db, session.user.shopId, on);
  revalidatePath(path);
  redirect(noticeUrl(path, on ? "year-on-diveday" : "year-off-diveday"));
}
