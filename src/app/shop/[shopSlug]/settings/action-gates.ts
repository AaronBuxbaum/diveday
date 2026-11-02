import { canPersonManagePaymentSettings, canPersonManageShopSettings } from "@/db/authz";
import type { ActionGate } from "@/features/server-action";

/* -------------------------------------------------------------------------- *
 * Shop settings mutations
 *
 * Every form on `./SettingsPage.tsx` posts to an action in one of this folder's
 * `*-actions.ts` files, split by the settings group (or sub-page) that owns it:
 * shop, website, messages, money, rentals, boats, team, bookings, data, trip
 * tags and packages. Each is a `defineAction` declaration (`src/features/server-action`):
 * the pipeline re-derives the session, asks the gates below against live roles,
 * reads the form, and lands where `run` says with `?notice=<code>&saved=<section>`
 * so the page can render the outcome *inside* the section that produced it.
 *
 * The notice codes are matched by `noticeMessages()` in `SettingsPage.tsx` and
 * the section ids by its `SECTION_IDS` — a new action needs a row in both.
 *
 * **Some editors answer on a page of their own**, not in a hub row: boats,
 * trip tags, dive packages, and (#1854) what the shop rents, its rental
 * prices, the emergency reference, the dock-day rhythm and the shop profile.
 * Their actions land on that page and carry no `?saved=` — there is no row to
 * reopen, and the page's own banner renders the code (`./sub-page-notices.ts`).
 * A refusal from either gate below still lands on the hub, which is where a
 * staffer who may not manage the shop can read why.
 * -------------------------------------------------------------------------- */

/**
 * **Every** mutation on the settings pages is owner/manager work, re-checked
 * against live roles rather than the roles baked into the JWT at sign-in.
 *
 * Hiding the page is a courtesy, never the gate: a server action is a POST
 * endpoint whose id ships to any browser that has ever rendered the form, so
 * without this a demoted staffer — or anyone who kept an old page open — could
 * still rewrite the shop's timezone, address, or packing list.
 */
export const SETTINGS_GATE: ActionGate = {
  allow: canPersonManageShopSettings,
  refusal: { notice: "not-authorized", landing: ["settings"] },
};

/**
 * Payment settings (Stripe Connect, the rental catalog and prices, packages)
 * are owner/manager work (H-20260724-staff-role-reach, ADR
 * 20260724-role-authorization), re-checked against live roles. Narrower than
 * {@link SETTINGS_GATE} by intent rather than by effect — the two resolve to
 * the same roles today, and each states its own reason so one can move
 * without silently dragging the other.
 */
export const PAYMENT_SETTINGS_GATE: ActionGate = {
  allow: canPersonManagePaymentSettings,
  refusal: { notice: "not-authorized", landing: ["settings"] },
};

/** Both gates, in the order the rental catalog and Stripe have always asked them. */
export const SETTINGS_AND_PAYMENT_GATES = [SETTINGS_GATE, PAYMENT_SETTINGS_GATE] as const;
