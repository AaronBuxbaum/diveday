import { z } from "zod";
import { DIVER_EMAIL_MAX } from "./person-fields";

/**
 * **The shore contact as a recipient** (H-118, decided 2026-10-15): the one
 * person outside the shop's accounts who hears, by email, when an after-dive
 * roll call is still open after the boat was due back
 * (`sendStaleRollCallAlerts`, `src/db/roll-call-alerts.ts`).
 *
 * An address is stored only with a consent: the staff member who saves it
 * ticks that the shore contact agreed to receive these alerts, and the row
 * keeps when and who. A new or changed address takes a fresh tick; the same
 * address saved again keeps the consent it already has; an empty box clears
 * both. There is no "address on file, not consented" state to send to by
 * mistake, and `shops_shore_alert_consent` holds the same pair in the table.
 *
 * Beside the free-text `emergencyReference.shoreContact`, never instead of
 * it: that is a name and a number a crew reads in an emergency.
 */

/** The three columns on `shops`, as one value. */
export type ShoreAlertContact = {
  email: string | null;
  consentAt: Date | null;
  consentByPersonId: string | null;
};

export const NO_SHORE_ALERT_CONTACT: ShoreAlertContact = {
  email: null,
  consentAt: null,
  consentByPersonId: null,
};

export type ShoreAlertRefusal = "invalid_email" | "consent_missing";

const shoreEmail = z.email().max(DIVER_EMAIL_MAX);

/** Who a stale roll call reaches ashore: the address, only with its consent on file. */
export function shoreAlertRecipient(contact: {
  email: string | null;
  consentAt: Date | null;
}): string | null {
  const email = contact.email?.trim() ?? "";
  if (email.length === 0 || contact.consentAt === null) return null;
  return email;
}

/**
 * What a settings save writes, or why it refuses. `consented` is the box as
 * posted; the box speaks for the address beside it, so it is required on
 * every save that keeps an address.
 */
export function nextShoreAlertContact(input: {
  current: ShoreAlertContact;
  email: string;
  consented: boolean;
  actorPersonId: string;
  now: Date;
}): { ok: true; value: ShoreAlertContact } | { ok: false; reason: ShoreAlertRefusal } {
  const email = input.email.trim();
  if (email.length === 0) return { ok: true, value: NO_SHORE_ALERT_CONTACT };
  if (!shoreEmail.safeParse(email).success) return { ok: false, reason: "invalid_email" };
  if (!input.consented) return { ok: false, reason: "consent_missing" };
  const same =
    input.current.email !== null &&
    input.current.consentAt !== null &&
    input.current.email.toLowerCase() === email.toLowerCase();
  if (same) return { ok: true, value: { ...input.current, email } };
  return {
    ok: true,
    value: { email, consentAt: input.now, consentByPersonId: input.actorPersonId },
  };
}
