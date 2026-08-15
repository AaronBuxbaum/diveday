import { z } from "zod";
import type { CertificationLevel } from "./readiness";

/**
 * **What an anonymous joiner is allowed to say about their own diving**, and
 * the only shape of it the server will accept.
 *
 * The two public "tell me when something comes up" opt-ins — the shop-wide
 * last-minute-deal list and a full trip's wait list — ask an optional
 * certification level and an optional nitrox tick (`DiveDeclarationFields`).
 * Both forms post to different actions in different route segments, and both
 * parse through here, so there is one answer to "what can a stranger write".
 *
 * Two properties this file exists to guarantee:
 *
 * 1. **A code, never free text.** The level is validated against the closed
 *    five-rung ladder rather than trusted from the post, so nothing
 *    attacker-controlled reaches the `certifications.level` column or the staff
 *    panels that render it. Nitrox is a boolean.
 * 2. **Absent is a real answer.** Both fields are optional and a joiner who
 *    skips them is "not said" — never a default, never a zero-value that reads
 *    as a claim. An unticked nitrox box in particular is silence, not "I am not
 *    nitrox certified", so it can never contradict a card already on file.
 */

/**
 * The ladder as a runtime tuple. The `satisfies` is the point: adding a rung to
 * `CertificationLevel` without adding it here is a **compile error**, so the
 * public forms can never quietly stop accepting a level the rest of the app
 * understands (the same guard shape as `LEVEL_CODES` in trip-admission.ts).
 */
export const DECLARABLE_CERTIFICATION_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
] as const satisfies readonly CertificationLevel[];

export const diveDeclarationSchema = z.object({
  certificationLevel: z.enum(DECLARABLE_CERTIFICATION_LEVELS).optional(),
  // The checkbox posts `on` or nothing at all. A literal rather than a coerced
  // boolean so an arbitrary posted string is a *refusal* to parse rather than a
  // truthy tick nobody made.
  nitroxCertified: z.literal("on").optional(),
});

export type DiveDeclaration = {
  level?: CertificationLevel;
  nitrox: boolean;
};

/**
 * The two optional fields as posted, ready for the parse. Empty strings become
 * `undefined` because an untouched `<select>` posts `""`, and zod's enum would
 * refuse that as an invalid level and take the whole join down with it — a
 * joiner who answered nothing must never see their sign-up refused.
 */
export function diveDeclarationInput(formData: FormData) {
  return {
    certificationLevel: formData.get("certificationLevel") || undefined,
    nitroxCertified: formData.get("nitroxCertified") || undefined,
  };
}

/** The parsed pair, in the shape `recordSelfDeclaredCards` takes. */
export function toDiveDeclaration(parsed: z.infer<typeof diveDeclarationSchema>): DiveDeclaration {
  return {
    level: parsed.certificationLevel,
    nitrox: parsed.nitroxCertified === "on",
  };
}
