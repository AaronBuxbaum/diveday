/** Hooks the rule tests scope to, named here so they cannot drift from the surface. */
export const AFTER_STATE_TEST_IDS = {
  record: "dive-record",
  sites: "dive-record-sites",
  plannedSites: "dive-record-planned-sites",
  conditions: "dive-record-conditions",
  stamp: "dive-record-stamp",
  certified: "dive-record-certified",
  visitLine: "dive-record-visit-line",
  printNotes: "dive-record-print-notes",
  printSignature: "dive-record-print-signature",
  face: "dive-record-face",
  seen: "dive-record-seen",
  flySafe: "fly-safe-line",
} as const;
