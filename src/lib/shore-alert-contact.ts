import { z } from "zod";
import { DAY_MS } from "./clock";
import { DIVER_EMAIL_MAX } from "./person-fields";

/**
 * **The shore contact as a recipient** (H-20261014-stale-roll-call-recipients, decided 2026-10-15): the one
 * person outside the shop's accounts who hears, by email, when an after-dive
 * roll call is still open after the boat was due back
 * (`sendStaleRollCallAlerts`, `src/db/roll-call-alerts.ts`).
 *
 * Two things stand between an address and the first alert:
 *
 * 1. **The shop's consent tick.** The staff member who saves the address ticks
 *    that the shore contact agreed to receive these alerts, and the row keeps
 *    when and who. The tick speaks only for the address it was drawn beside:
 *    the form posts that address with it (`consentFor`), and a save whose typed
 *    address differs is refused, so a changed address never inherits the old
 *    tick. The same address saved again keeps the consent it already has; an
 *    empty address clears everything. `shops_shore_alert_consent` holds the
 *    address and its consent together in the table.
 * 2. **The inbox's own confirmation.** Saving a new or changed address sends a
 *    link to it (`src/db/shore-alert-tokens.ts`); until it is opened,
 *    `confirmedAt` is null and nothing is sent. Every alert carries a link that
 *    takes the address off the shop.
 *
 * Beside the free-text `emergencyReference.shoreContact`, never instead of
 * it: that is a name and a number a crew reads in an emergency, and DiveDay
 * never messages it.
 */

/** The four columns on `shops`, as one value. */
export type ShoreAlertContact = {
  email: string | null;
  consentAt: Date | null;
  consentByPersonId: string | null;
  confirmedAt: Date | null;
};

export const NO_SHORE_ALERT_CONTACT: ShoreAlertContact = {
  email: null,
  consentAt: null,
  consentByPersonId: null,
  confirmedAt: null,
};

export type ShoreAlertRefusal = "invalid_email" | "consent_missing";

/** What a save did to the address, for the activity line and the notice. */
export type ShoreAlertChange = "set" | "changed" | "cleared" | "unchanged";

/**
 * How long a confirmation link lives. A week rather than the front desk's
 * three days: the reader is somebody outside the shop, who may not open the
 * mail the day the shop saves their address.
 */
export const SHORE_ALERT_CONFIRMATION_TTL_MS = 7 * DAY_MS;

const shoreEmail = z.email().max(DIVER_EMAIL_MAX);

const sameAddress = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Who a stale roll call reaches ashore: the address, only with its consent and confirmation on file. */
export function shoreAlertRecipient(contact: {
  email: string | null;
  consentAt: Date | null;
  confirmedAt: Date | null;
}): string | null {
  const email = contact.email?.trim() ?? "";
  if (email.length === 0 || contact.consentAt === null || contact.confirmedAt === null) {
    return null;
  }
  return email;
}

/**
 * What a settings save writes, or why it refuses. `consented` is the box as
 * posted and `consentFor` the address the box was drawn ticked for ("" when
 * it was drawn empty): the box speaks for that address and no other.
 */
export function nextShoreAlertContact(input: {
  current: ShoreAlertContact;
  email: string;
  consented: boolean;
  consentFor: string;
  actorPersonId: string;
  now: Date;
}):
  | { ok: true; value: ShoreAlertContact; change: ShoreAlertChange }
  | { ok: false; reason: ShoreAlertRefusal } {
  const email = input.email.trim();
  if (email.length === 0) {
    return {
      ok: true,
      value: NO_SHORE_ALERT_CONTACT,
      change: input.current.email === null ? "unchanged" : "cleared",
    };
  }
  if (!shoreEmail.safeParse(email).success) return { ok: false, reason: "invalid_email" };
  if (!input.consented) return { ok: false, reason: "consent_missing" };
  const consentFor = input.consentFor.trim();
  if (consentFor.length > 0 && !sameAddress(consentFor, email)) {
    return { ok: false, reason: "consent_missing" };
  }
  const current = input.current;
  if (current.email !== null && current.consentAt !== null && sameAddress(current.email, email)) {
    return { ok: true, value: { ...current, email }, change: "unchanged" };
  }
  return {
    ok: true,
    value: {
      email,
      consentAt: input.now,
      consentByPersonId: input.actorPersonId,
      confirmedAt: null,
    },
    change: current.email === null ? "set" : "changed",
  };
}
