/**
 * **Why the boat did not dive the plan** (issue #1184, delight report D24; ADR
 * 20260904-reef-all-the-way-down, slice 16d).
 *
 * Framework-free and value-only, because both ends need it: `src/db/schema.ts`
 * builds the `plan_change_reason` pgEnum from this tuple, and the dive log is a
 * Client Component that must not pull drizzle into the browser bundle to know
 * the bound on a note.
 */

/**
 * The four the canvas drew — "current, weather, vis, or a better call".
 *
 * `crew_call` is deliberately the honest fourth. A skipper who moved the boat
 * because they judged it better is the commonest real reason a Key Largo
 * departure changes site, and a list without it launders that judgement into
 * "conditions". It reaches a diver's own record, so it is a code worded per
 * reader rather than a sentence typed once in English.
 */
export const PLAN_CHANGE_REASONS = ["current", "weather", "visibility", "crew_call"] as const;

export type PlanChangeReason = (typeof PLAN_CHANGE_REASONS)[number];

/**
 * The longest staff-only note the dive log accepts, matching the
 * `executed_dives_plan_change_note_length` check.
 *
 * Short on purpose. D27's boundary is "do not create a second staff chat", and
 * a box that holds a paragraph becomes one; this holds a sentence about why the
 * boat moved and nothing more.
 */
export const PLAN_CHANGE_NOTE_MAX = 280;
