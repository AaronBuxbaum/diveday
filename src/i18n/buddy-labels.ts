import type { BuddyAlert } from "@/lib/manifests";
import type { PartyLeftReason } from "@/lib/party-teams";
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
 * (dive-domain review of UX batch 1). The dock words say "not aboard yet",
 * never "ashore": a teammate the crew recorded staying ashore raises nothing.
 *
 * The words name the buddy, not a count: a team of four with two unaccounted
 * for is the same instruction as a pair with one, and naming a number here
 * would invite reading it as a severity scale it is not. They say "Buddy",
 * never "Someone": the chip sits on the row of the diver who *is* aboard,
 * and "Someone not aboard" on that row read as this diver being missing
 * (UX review 2026-10-10, item 23).
 */
const BUDDY_ALERT_KEYS: Record<BuddyAlert, StaffMessageKey> = {
  separated_dock: "shared.buddyTeam.separatedDock",
  separated_after_dive: "shared.buddyTeam.separatedAfterDive",
};

/** The one sentence a buddy alert renders as, in the staff bundle's language. */
export function buddyAlertText(t: StaffTranslator, alert: BuddyAlert): string {
  return t(BUDDY_ALERT_KEYS[alert]);
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
  junior_without_adult: "manifest.buddyPartyLeftReason.junior_without_adult",
};

/** The reason a party was left, in the staff bundle's language. */
export function partyLeftReasonText(t: StaffTranslator, reason: PartyLeftReason): string {
  return t(PARTY_LEFT_KEYS[reason]);
}
