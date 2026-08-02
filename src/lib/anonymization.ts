import { randomUUID } from "node:crypto";

/**
 * Sentinels the diver-erasure path writes into columns that cannot hold null
 * (ADR 20260802-diver-data-erasure).
 *
 * These are **data values, not copy**: they land in `people.full_name`,
 * `activity_events.message`, and the certification identifier columns, all of
 * which are `NOT NULL` (two of them additionally carry a non-blank check), so
 * "erase it" has to mean "overwrite it with something that says nothing". They
 * are deliberately bracketed and lowercase so no surface can mistake one for a
 * real name, note, or card number, and so they read the same in every locale —
 * an erased record is a fact about the data, not a message to a reader.
 */
export const ANONYMIZED_PERSON_NAME = "[anonymized]";

/** Replacement for free prose that a NOT NULL / non-blank check forbids clearing. */
export const REDACTED_TEXT = "[redacted]";

/**
 * A one-off replacement for a `NOT NULL` column that also sits inside a unique
 * index — `certifications.identifier` and its specialty/nitrox siblings, and
 * `prior_visits.dedupe_key`. A fixed sentinel would collide the moment a second
 * diver is erased at the same shop, so each replacement is unique by
 * construction while carrying none of the value it replaced.
 */
export function redactedUniqueValue(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
