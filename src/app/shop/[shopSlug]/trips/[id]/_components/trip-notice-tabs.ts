/**
 * **Which tab a save's answer lands on.** The About forms redirect to the
 * departure with their `form`, which is enough to know the answer belongs on
 * Details, so no action needs to know the tab.
 */
export const DETAILS_FORMS: ReadonlySet<string> = new Set([
  "details",
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

/** Forms whose answer belongs with the roster, on the Divers tab. */
export const ROSTER_FORMS: ReadonlySet<string> = new Set(["roster", "add-diver"]);
