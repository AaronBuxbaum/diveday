import type { FormNotice } from "@/lib/staff-notices";

/**
 * **Which tab a save's answer lands on.** The About forms redirect to the
 * departure with their `form`, which is enough to know the answer belongs on
 * Details, so no action needs to know the tab.
 */
export const DETAILS_FORMS: ReadonlySet<string> = new Set([
  "details",
  "safety-record",
  "plan",
  "meeting",
  "timing",
  "booking",
  "boat",
  "departure",
  "requirements",
  "conditions",
  "crew",
  "series",
  "lifecycle",
  // Who else may come aboard, and at what price (ADR 20261007-participant-types).
  "participant-terms",
  // Promote lives on Details (`TripPromoteAndActivity`), so its answer does.
  "last-minute-deal",
]);

/**
 * **Details is its own tab**, and a save on it lands back on it. `?add=1`
 * wins over `?view=details`: the add band is on Divers (#2737).
 */
export function showsDetailsTab(
  view: string | undefined,
  add: string | undefined,
  tripNotice: FormNotice | undefined,
): boolean {
  return (view === "details" && !add) || Boolean(tripNotice && DETAILS_FORMS.has(tripNotice.form));
}

/** Forms whose answer belongs with the roster, on the Divers tab. */
export const ROSTER_FORMS: ReadonlySet<string> = new Set(["roster", "add-diver"]);

/**
 * The two page-level slots a save's answer can take: the top of the page for
 * an answer no tab owns, and the roster's own banner for the roster's.
 */
export function pageNoticesFor(tripNotice: FormNotice | undefined): {
  rootPageNotice: FormNotice | undefined;
  rosterPageNotice: FormNotice | undefined;
} {
  return {
    rootPageNotice:
      tripNotice && !DETAILS_FORMS.has(tripNotice.form) && !ROSTER_FORMS.has(tripNotice.form)
        ? tripNotice
        : undefined,
    rosterPageNotice: tripNotice && tripNotice.form === "roster" ? tripNotice : undefined,
  };
}
