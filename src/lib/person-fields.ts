import { z } from "zod";

/**
 * Bounded diver person fields (name / email / phone) shared by every form that
 * creates or edits a person row. Before this module, six actions each carried
 * their own copy of these bounds and they had drifted — name `min(1)` here and
 * `min(2)` there, email `max(200)` vs `max(320)`, phone `max(30)` vs `max(40)`
 * — so what counted as a valid diver depended on which door they came through.
 * One set of bounds, the most permissive of the drifted copies so nothing
 * already stored becomes invalid, following the `emergencyContactSchema`
 * precedent (src/lib/contact.ts).
 *
 * The fragments carry bounds only, never per-site error copy: each action
 * composes them into its own schema (required vs optional vs blank-able email
 * is a per-surface call) and keeps its own error keys/codes.
 */
export const DIVER_NAME_MAX = 120;
export const DIVER_EMAIL_MAX = 320;
export const DIVER_PHONE_MAX = 40;

export const diverNameSchema = z.string().trim().min(1).max(DIVER_NAME_MAX);
export const diverEmailSchema = z.email().max(DIVER_EMAIL_MAX);
export const diverPhoneSchema = z.string().trim().max(DIVER_PHONE_MAX);
