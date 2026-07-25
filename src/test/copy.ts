/**
 * Internal vocabulary that must never appear in copy a shop owner reads.
 *
 * The switching pages and the in-app importer render their source data verbatim
 * — `IMPORT_HONESTY_TABLE`, `MIGRATION_GUIDES` — which is what keeps the
 * marketing promise and the running code in step. The cost of that is that a
 * note written for the next agent ("see the imported-waiver ADR") ships to a
 * customer as a dead end. Copy should say the thing the reference points at.
 *
 * Matched: ADR ids and the bare word, decision-register ids (H-13), codebase
 * review ids (CR-016), reviewer-agent names, and source paths. Keep this list to
 * things that are *only* ever internal — a word a shop owner might legitimately
 * read in product copy does not belong here.
 */
export const INTERNAL_VOCABULARY =
  /\bADRs?\b|\b20\d{6}-[a-z-]+\b|\bH-\d\d\b|\bCR-\d{3}\b|dive-domain-expert|security-reviewer|human-decisions|\bsrc\/[a-z]|\.tsx?\b/;
