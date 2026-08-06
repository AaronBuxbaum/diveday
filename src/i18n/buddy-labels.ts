import type { BuddyAlert } from "@/lib/manifests";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words and tone a buddy alert wears (ADR 20260804-buddy-teams). The lib
 * layer hands back a code (`buddyAlertFor`, src/lib/manifests.ts); this is
 * the one resolver every staff surface renders it through, so a split buddy
 * team can never read differently on two screens — the same rule
 * `src/i18n/readiness-labels.ts` states for Blocked/Ready.
 *
 * The after-dive words are deliberately "unaccounted for" — the glossary's
 * own umbrella for awaiting-or-stated-missing — never "not back aboard",
 * which is the taxonomy's phrase for a statement a human actually made. The
 * alert fires on an awaiting teammate too, and it must not put words in the
 * crew's mouth (dive-domain review, 2026-08-04).
 *
 * The words say "someone", not a count: a team of four with two unaccounted
 * for is the same instruction as a pair with one, and naming a number here
 * would invite reading it as a severity scale it is not.
 */
const BUDDY_ALERT_KEYS: Record<BuddyAlert, StaffMessageKey> = {
  separated_dock: "shared.buddyTeam.separatedDock",
  separated_after_dive: "shared.buddyTeam.separatedAfterDive",
};

/** The one sentence a buddy alert renders as, in the staff bundle's language. */
export function buddyAlertText(t: StaffTranslator, alert: BuddyAlert): string {
  return t(BUDDY_ALERT_KEYS[alert]);
}
