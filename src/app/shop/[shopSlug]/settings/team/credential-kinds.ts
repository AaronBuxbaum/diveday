import type { staffCredentials } from "@/db/schema";
import type { StaffMessageKey } from "@/i18n/staff-messages";

/** The words for each kind a staff credential can be filed as, in the picker and the list alike. */
export const CREDENTIAL_KIND_KEYS: Record<
  (typeof staffCredentials.kind.enumValues)[number],
  StaffMessageKey
> = {
  instructor_rating: "staffing.credentials.kinds.instructor_rating",
  assistant_instructor_rating: "staffing.credentials.kinds.assistant_instructor_rating",
  divemaster_rating: "staffing.credentials.kinds.divemaster_rating",
  liability_insurance: "staffing.credentials.kinds.liability_insurance",
  first_aid_cpr: "staffing.credentials.kinds.first_aid_cpr",
  oxygen_provider: "staffing.credentials.kinds.oxygen_provider",
  captains_licence: "staffing.credentials.kinds.captains_licence",
  other: "staffing.credentials.kinds.other",
};
