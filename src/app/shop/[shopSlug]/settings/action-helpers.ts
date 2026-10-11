import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { revalidateAndRedirect } from "@/lib/navigation";
import { noticeUrl, shopPath } from "@/lib/staff-notices";

/* -------------------------------------------------------------------------- *
 * Shop settings mutations
 *
 * Every form on `./SettingsPage.tsx` posts to an action in one of this folder's
 * `*-actions.ts` files, split by the settings group (or sub-page) that owns it:
 * shop, website, messages, money, rentals, boats, team, bookings, data, trip
 * tags and packages. This file is what they share. They share a shape:
 * re-derive the session server-side, validate the submission, refuse by
 * redirecting back to the settings page with `?notice=<code>&saved=<section>`
 * so the page can render the refusal *inside* the section that produced it, and
 * on success revalidate and redirect the same way with a success code. Both
 * halves of that URL are built rather than concatenated — `shopPath` for the
 * path (the slug is a client-supplied argument) and `noticeUrl` for the query
 * (src/lib/staff-notices.ts), which encodes every value and holds the code to
 * its one lower-case-kebab spelling.
 *
 * The notice codes are matched by `noticeMessages()` in `SettingsPage.tsx` and
 * the section ids by its `SECTION_IDS` — a new action needs a row in both.
 *
 * **Some editors answer on a page of their own**, not in a hub row: boats,
 * trip tags, dive packages, and (#1854) what the shop rents, its rental
 * prices, the emergency reference, the dock-day rhythm and the shop profile.
 * Their actions sit beside the group's others, sharing validation and
 * vocabulary with them, but they
 * name `page` rather than `settings` and carry no `?saved=` — there is no row
 * to reopen, and the page's own banner renders the code
 * (`./sub-page-notices.ts`). A refusal from `settingsBlock` still lands on the
 * hub, which is where a staffer who may not manage the shop can read why.
 * -------------------------------------------------------------------------- */

/**
 * **Every** mutation on this page is owner/manager work now, re-checked here
 * against live roles rather than the roles baked into the JWT at sign-in.
 *
 * Hiding the page is a courtesy, never the gate: a server action is a POST
 * endpoint whose id ships to any browser that has ever rendered the form, so
 * without this a demoted staffer — or anyone who kept an old page open — could
 * still rewrite the shop's timezone, address, or packing list. Refusal
 * redirects here so callers cannot forget to act on a returned target.
 */
export async function settingsBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<void> {
  const settings = shopPath(session.user.shopSlug, "settings");
  const allowed = await canPersonManageShopSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) revalidateAndRedirect(settings, noticeUrl(settings, "not-authorized"));
}

/**
 * Payment settings (Stripe Connect and the rental catalog/prices) are
 * owner/manager work (H-14, ADR 20260724-role-authorization), re-checked
 * against live roles. Refusal redirects here so callers cannot forget to act
 * on a returned target. Narrower than {@link settingsBlock} by intent rather
 * than by effect — the two resolve to the same roles today, and each states
 * its own reason so one can move without silently dragging the other.
 */
export async function paymentSettingsBlock(session: {
  user: { shopId: string; personId: string; shopSlug: string };
}): Promise<void> {
  const settings = shopPath(session.user.shopSlug, "settings");
  const allowed = await canPersonManagePaymentSettings(
    await getDb(),
    session.user.shopId,
    session.user.personId,
  );
  if (!allowed) revalidateAndRedirect(settings, noticeUrl(settings, "not-authorized"));
}
