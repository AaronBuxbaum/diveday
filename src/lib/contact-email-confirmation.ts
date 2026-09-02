import { DAY_MS } from "@/lib/clock";

/**
 * The bearer link that proves a shop controls its front-desk address before
 * that address becomes `Reply-To` on diver mail (issue #1288; ADR
 * 20260902-sender-standards-for-ses, amended). Token bytes and digest come from
 * `src/lib/bearer-tokens.ts`; this module holds only what is specific to the
 * surface: how long a link lives and where it points.
 *
 * Three days, the same window as account email verification and for the same
 * reason: low stakes -- an unconfirmed address costs the shop nothing but
 * Reply-To -- and a front desk that does not open its inbox the same day.
 */
export const CONTACT_EMAIL_CONFIRMATION_TTL_MS = 3 * DAY_MS;

export function confirmContactLinkPath(token: string): string {
  return `/confirm-contact/${token}`;
}
