import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import type { TripManifest } from "@/lib/manifests";

/**
 * **A drafted emergency text** (issue #4256). Under an emergency contact on
 * the manifest's person sheet, one link opens the phone's message app with a
 * draft that already says which shop, which captain and which departure, so a
 * stressed crew member is not composing it from nothing. A person reads it,
 * edits it and presses Send: DiveDay sends nothing, records nothing, and never
 * escalates on its own.
 *
 * It is not a call button (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 3, amended for this): a mis-tap opens a draft nobody sent, which is
 * the whole difference from a dial. Screen only; paper has nothing to tap.
 */
export type EmergencyTextFacts = {
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  /** The departure's captain by the roster; null words the draft without one. */
  captainName: string | null;
  locale: string;
  timezone: string;
};

/** The first crew member rostered as this departure's captain, or null. */
export function departureCaptain(crew: TripManifest["crew"]): string | null {
  return crew.find((member) => member.roles.includes("captain"))?.fullName ?? null;
}

/** The draft's words: the contact's person, the shop, the departure, and its captain when known. */
export function emergencyTextBody(
  t: StaffTranslator,
  facts: EmergencyTextFacts,
  personName: string,
): string {
  const values = {
    person: personName,
    shop: facts.shopName,
    trip: facts.tripTitle,
    date: formatShortDate(facts.startsAt, facts.locale, facts.timezone),
  };
  return facts.captainName
    ? t("manifest.emergencyText.bodyWithCaptain", { ...values, captain: facts.captainName })
    : t("manifest.emergencyText.body", values);
}

/**
 * An `sms:` link carrying the draft. The number keeps its leading `+` and its
 * digits only, since separators break some message apps; `?&body=` is the
 * form both iOS and Android read. Null for a number with no digits, so no link
 * is drawn that would open an empty conversation.
 */
export function emergencyTextHref(phone: string, body: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (!/\d/.test(digits)) return null;
  return `sms:${digits}?&body=${encodeURIComponent(body)}`;
}
