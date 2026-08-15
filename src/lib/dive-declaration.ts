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

/**
 * **"I'm not certified yet" — an answer, and deliberately not a rung.**
 *
 * At a Florida or Caribbean shop a large share of the people joining these
 * lists hold no card at all, and until this value existed their only honest
 * option was "Rather not say" — which reads to staff exactly like a certified
 * regular who skipped the question, so the shop mails them a certified two-tank
 * charter (ADR 20260814-self-declared-cards, amendment 2026-08-15).
 *
 * It rides *beside* the ladder rather than inside it. `CertificationLevel` is
 * an ordering that `certificationRank` sorts and `trip-admission.ts` asserts
 * against, so a "none" member would join that ordering and the first comparison
 * treating rank 0 as a level would admit a non-diver to a departure that asks
 * for nothing in particular. The tuple above therefore stays exactly five rungs
 * and keeps its `satisfies`; this is a sixth *option on a select*, which is a
 * different thing.
 *
 * The wire value is namespaced away from the level codes so nothing can ever
 * `as CertificationLevel` it by accident.
 */
export const NO_CERTIFICATION_ANSWER = "none_declared";

export const diveDeclarationSchema = z.object({
  certificationLevel: z
    .enum([...DECLARABLE_CERTIFICATION_LEVELS, NO_CERTIFICATION_ANSWER])
    .optional(),
  // The checkbox posts `on` or nothing at all. A literal rather than a coerced
  // boolean so an arbitrary posted string is a *refusal* to parse rather than a
  // truthy tick nobody made.
  nitroxCertified: z.literal("on").optional(),
});

export type DiveDeclaration = {
  level?: CertificationLevel;
  /**
   * True when the joiner picked {@link NO_CERTIFICATION_ANSWER}. Mutually
   * exclusive with `level` as `toDiveDeclaration` produces it — one `<select>`
   * cannot post both — and `recordSelfDeclaredCards` refuses to record a
   * contradiction if some other caller ever sends one.
   */
  noCertification: boolean;
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

/**
 * The parsed answers, in the shape `recordSelfDeclaredCards` takes.
 *
 * The one `<select>` carries two different kinds of answer, and they are split
 * here rather than downstream: a level is a rung on the ladder, while "not
 * certified yet" is a statement that there is no card to hold at all, and it
 * lands on the person instead of in `certifications`. Splitting at the parse
 * boundary is what keeps `level` typed as a `CertificationLevel` all the way to
 * the column.
 */
export function toDiveDeclaration(parsed: z.infer<typeof diveDeclarationSchema>): DiveDeclaration {
  const answer = parsed.certificationLevel;
  return {
    level: answer === NO_CERTIFICATION_ANSWER ? undefined : answer,
    noCertification: answer === NO_CERTIFICATION_ANSWER,
    nitrox: parsed.nitroxCertified === "on",
  };
}
