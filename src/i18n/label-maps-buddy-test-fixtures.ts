import type { BuddyAlert } from "@/lib/manifests";
import type { PartyLeftReason } from "@/lib/party-teams";
import { buddyAlertText, partyLeftReasonText } from "./buddy-labels";
import { codeRows, everyCodeOf, type LabelMapCase } from "./label-map-test-fixtures";
import { staffTranslator } from "./staff-messages";

const BUDDY_ALERTS = everyCodeOf<BuddyAlert>({
  separated_dock: true,
  separated_after_dive: true,
  teammate_ashore: true,
});

const PARTY_LEFT_REASONS = everyCodeOf<PartyLeftReason>({
  intro_course: true,
  training_course: true,
  young_child: true,
  minor_age_conflict: true,
  minor_age_unknown: true,
  mixed_ages_unconfirmed: true,
  junior_without_adult: true,
  junior_requirements_unconfirmed: true,
  too_large: true,
});

export const BUDDY_LABEL_MAP_CASES: readonly LabelMapCase[] = [
  {
    module: "buddy-labels.ts",
    map: "BUDDY_ALERT_KEYS",
    rows: codeRows(BUDDY_ALERTS, (locale, alert) => buddyAlertText(staffTranslator(locale), alert)),
  },
  {
    module: "buddy-labels.ts",
    map: "BUDDY_ALERT_NAMED_KEYS",
    rows: codeRows(BUDDY_ALERTS, (locale, alert) =>
      buddyAlertText(staffTranslator(locale), alert, ["Ravi Patel"]),
    ),
  },
  {
    module: "buddy-labels.ts",
    map: "PARTY_LEFT_KEYS",
    rows: codeRows(PARTY_LEFT_REASONS, (locale, reason) =>
      partyLeftReasonText(staffTranslator(locale), reason),
    ),
  },
];
