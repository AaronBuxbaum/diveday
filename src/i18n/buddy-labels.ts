import type { BuddyAlert } from "@/lib/manifests";
import type { PartyLeftReason } from "@/lib/party-teams";
import { firstNameOf } from "@/lib/person-name";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words and tone a buddy alert wears (ADR 20260804-buddy-teams). The lib
 * layer hands back a code (`buddyAlertFor`, src/lib/manifests.ts); this is
 * the one resolver every staff surface renders it through, so a split buddy
 * team can never read differently on two screens — the same rule
 * `src/i18n/readiness-labels.ts` states for Blocked/Ready.
 *
 * The after-dive words are "not back aboard", the taxonomy's phrase for a
 * statement a human actually made, because that is now the only thing that
 * raises the alert: `buddyAlertFor` fires after a dive only on a teammate the
 * crew recorded as not back (ADR 20260827-the-departure-is-two-working-surfaces,
 * decision 4), never on one merely uncalled. "Unaccounted for" undersold it
 * (dive-domain review of UX batch 1). The dock words say "not aboard yet"
 * about an uncalled teammate, and "staying ashore" about a recorded absence.
 *
 * The words name the buddy, not a count: a team of four with two unaccounted
 * for is the same instruction as a pair with one, and naming a number here
 * would invite reading it as a severity scale it is not. They say "Buddy",
 * never "Someone": the chip sits on the row of the diver who *is* aboard,
 * and "Someone not aboard" on that row read as this diver being missing
 * (UX review 2026-10-10, item 23). A buddy recorded staying ashore instead
 * prompts re-pairing, including a carried-forward dock absence. That heads-up
 * never wears the after-dive alarm's words or danger tone.
 *
 * **Naming the teammate** (#2403, Aaron 2026-10-13): when exactly one
 * teammate raises the alert, the chip says who, by first name ("Ravi not
 * aboard yet"), because a crew member acts faster on a name than on "Buddy".
 * That is still not a count: with two or more teammates the chip keeps the
 * generic words, so it never reads as a severity scale. A name longer than
 * `MAX_NAME_CHARS` is cut with an ellipsis; the chip's room at 390px is
 * about two characters more than the Spanish generic words, and
 * `buddy-labels.test.ts` holds the longest named string to that.
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

/** Longest first name the chip carries before it is cut with an ellipsis. */
export const MAX_NAME_CHARS = 9;

/** A first name cut to `MAX_NAME_CHARS` characters (code points) and an ellipsis. */
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
 * Why "Team up each party" left a party for the divemaster (dive-domain review
 * of layer r5-4, BLOCK 1): the panel says it beside the names, so a skipped
 * party never reads as a button that did nothing.
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
