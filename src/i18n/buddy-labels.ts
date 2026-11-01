import type { BuddyAlert } from "@/lib/manifests";
import type { PartyLeftReason } from "@/lib/party-teams";
import { firstNameOf } from "@/lib/person-name";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * Resolves buddy alert codes for staff (ADR 20260804-buddy-teams). After a
 * dive, an alert reflects a crew-recorded not-back status (ADR
 * 20260827-the-departure-is-two-working-surfaces, decision 4). Dock
 * unconfirmed means "not aboard yet"; recorded after-dive status means "not
 * back aboard". Ashore prompts re-pairing and is distinct from that alarm.
 * Messages avoid counts and name a teammate only when exactly one usable name
 * raises the alert; multiple teammates use generic wording.
 */
const BUDDY_ALERT_KEYS: Record<BuddyAlert, StaffMessageKey> = {
  separated_dock: "shared.buddyTeam.separatedDock",
  separated_after_dive: "shared.buddyTeam.separatedAfterDive",
  teammate_ashore: "shared.buddyTeam.ashore",
};

const BUDDY_ALERT_NAMED_KEYS: Record<BuddyAlert, StaffMessageKey> = {
  separated_dock: "shared.buddyTeam.separatedDockNamed",
  separated_after_dive: "shared.buddyTeam.separatedAfterDiveNamed",
  teammate_ashore: "shared.buddyTeam.ashoreNamed",
};

/** Maximum first-name length in code points before the chip adds an ellipsis. */
export const MAX_NAME_CHARS = 9;

/** A first name cut to `MAX_NAME_CHARS` code points and an ellipsis. */
function chipName(name: string): string {
  const chars = Array.from(name.normalize("NFC"));
  return chars.length > MAX_NAME_CHARS ? `${chars.slice(0, MAX_NAME_CHARS).join("")}…` : name;
}

/**
 * The one sentence a buddy alert renders as, in the staff bundle's language.
 * `missing` is who raises it (`buddyMissing` on the manifest row): exactly one
 * name with a usable first word is spoken; none, many or a blank name keeps the
 * generic words.
 */
export function buddyAlertText(
  t: StaffTranslator,
  alert: BuddyAlert,
  missing: readonly string[] = [],
): string {
  const [only] = missing;
  const name = missing.length === 1 ? firstNameOf(only, "") : "";
  if (!name) return t(BUDDY_ALERT_KEYS[alert]);
  return t(BUDDY_ALERT_NAMED_KEYS[alert], { name: chipName(name) });
}

/**
 * Shown beside party names so a skipped party is not mistaken for a failed action.
 */
const PARTY_LEFT_KEYS: Record<PartyLeftReason, StaffMessageKey> = {
  intro_course: "manifest.buddyPartyLeftReason.intro_course",
  training_course: "manifest.buddyPartyLeftReason.training_course",
  too_large: "manifest.buddyPartyLeftReason.too_large",
  young_child: "manifest.buddyPartyLeftReason.young_child",
  minor_age_conflict: "manifest.buddyPartyLeftReason.minor_age_conflict",
  minor_age_unknown: "manifest.buddyPartyLeftReason.minor_age_unknown",
  mixed_ages_unconfirmed: "manifest.buddyPartyLeftReason.mixed_ages_unconfirmed",
  junior_without_adult: "manifest.buddyPartyLeftReason.junior_without_adult",
  junior_requirements_unconfirmed: "manifest.buddyPartyLeftReason.junior_requirements_unconfirmed",
};

/** The reason a party was left, in the staff bundle's language. */
export function partyLeftReasonText(t: StaffTranslator, reason: PartyLeftReason): string {
  return t(PARTY_LEFT_KEYS[reason]);
}
