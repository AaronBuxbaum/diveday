import type { RecapPulseCategory } from "@/db/recap-pulses";
// **The leaf, not `@/lib/readiness`** — the same bundle rule
// `src/i18n/readiness-labels.ts` states at its own first import. This module is
// read by the recap, one of the pages a diver opens on a boat.
import type { CertificationLevel } from "@/lib/certification-levels";
import type { NextDiveReason } from "@/lib/next-dive";
import type { DiverMessageKey } from "./messages";
import type { StaffMessageKey } from "./staff-messages";

/**
 * The codes this slice's three surfaces return, and where each one's words
 * live — the pattern `src/i18n/readiness-labels.ts` and
 * `src/i18n/gear-labels.ts` set (ADR 20260731-domain-layer-copy-leaks, and
 * slice 16i of ADR 20260904-reef-all-the-way-down).
 *
 * Written as whole keys rather than templates so each message id is a literal
 * the translator's type checks — a `${string}` interpolation is a key nobody
 * proves exists.
 */

/** One reason sentence per `NextDiveReason`, in the diver's own language. */
export const NEXT_DIVE_REASON_KEYS: Record<NextDiveReason, DiverMessageKey> = {
  crew_named_site: "recap.nextDiveCrewNamedSite",
  course_next_session: "recap.nextDiveCourseSession",
  same_site: "recap.nextDiveSameSite",
  soonest_with_room: "recap.nextDiveSoonest",
};

/**
 * The five rungs, in the diver bundle.
 *
 * This map used to be inlined in `src/app/s/[shopSlug]/register/RegisterForm.tsx`
 * and nowhere else; the next-dive card is the second reader, so it lives here
 * once rather than twice. The staff bundle has its own copy of the same ladder
 * in `readiness-labels.ts` — deliberately, because staff and diver copy are
 * different bundles and a shared key would put one shop-facing word on a
 * diver's keepsake.
 */
export const DIVER_CERT_LEVEL_KEYS: Record<CertificationLevel, DiverMessageKey> = {
  open_water: "course.certificationLevels.openWater",
  advanced_open_water: "course.certificationLevels.advancedOpenWater",
  rescue: "course.certificationLevels.rescue",
  divemaster: "course.certificationLevels.divemaster",
  instructor: "course.certificationLevels.instructor",
};

/** The pulse's five chips, as the diver is offered them. */
export const RECAP_PULSE_CATEGORY_KEYS: Record<RecapPulseCategory, DiverMessageKey> = {
  gear: "recap.pulseGear",
  briefing: "recap.pulseBriefing",
  boat: "recap.pulseBoat",
  timing: "recap.pulseTiming",
  other: "recap.pulseOther",
};

/**
 * The same five, as the shop reads them on its own panel — one word each rather
 * than the diver's phrasing, because the staff row already sits under a heading
 * saying what the list is.
 */
export const STAFF_PULSE_CATEGORY_KEYS: Record<RecapPulseCategory, StaffMessageKey> = {
  gear: "reviews.pulseCategoryGear",
  briefing: "reviews.pulseCategoryBriefing",
  boat: "reviews.pulseCategoryBoat",
  timing: "reviews.pulseCategoryTiming",
  other: "reviews.pulseCategoryOther",
};
