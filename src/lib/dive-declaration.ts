import { z } from "zod";
import { type CertificationAgency, certificationAgency } from "@/db/schema";
import { isPlausibleCardNumber, MAX_CARD_NUMBER_LENGTH } from "./card-number";
import { NO_CERTIFICATION_ANSWER } from "./certification-options";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "./rate-limit";
import type { CertificationLevel } from "./readiness";

/**
 * **What an anonymous joiner is allowed to say about their own diving**, and
 * the only shape of it the server will accept.
 *
 * Two public forms ask — the shop-wide last-minute-deal list and a full trip's
 * wait list — and between them they collect an optional certification level, an
 * optional agency and card number, and an optional nitrox tick
 * (`DiveDeclarationFields`). They post to different actions in different route
 * segments and both parse through here, so there is one answer to "what can a
 * stranger write".
 *
 * The trip booking form asked too, per diver, between 2026-08-20 and
 * 2026-08-27. It no longer asks, and its per-index reader is gone with the
 * fields rather than left standing: an action that accepts what no form
 * renders is a route a hand-crafted POST has and an honest diver does not.
 * `/ready/<token>` asks the diver whose booking it is instead.
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
export { NO_CERTIFICATION_ANSWER } from "./certification-options";

/**
 * **The card number, as a stranger may type it.**
 *
 * The same two properties `isPlausibleCardNumber` asserts anywhere else — three
 * characters and a digit — and for the same reason: it is a typo filter, never
 * proof, and nothing downstream may cite it as evidence. What is different here
 * is what a *failure* costs. This box is optional on a booking form, so a number
 * that does not survive the filter must not take the booking down with it:
 * `diveDeclarationSchema` catches the refusal and drops the field
 * (`toDiveDeclaration`), leaving the level standing on its own.
 */
const declaredCardNumberSchema = z
  .string()
  .trim()
  .max(MAX_CARD_NUMBER_LENGTH)
  .refine(isPlausibleCardNumber);

export const diveDeclarationSchema = z.object({
  certificationLevel: z
    .enum([...DECLARABLE_CERTIFICATION_LEVELS, NO_CERTIFICATION_ANSWER])
    .optional(),
  /**
   * **Which body issued the card, and its number — both optional, both inert.**
   *
   * A level alone was all these forms collected until 2026-08-21, which left
   * "verified before the dive date" with nothing to work from: the queue read
   * "Advanced Open Water (self-declared)" and the only check available was the
   * sighting at the dock that was happening anyway (issue #630, from #609).
   *
   * Optional is the decision, not the default. A diver who knows their rung but
   * not their number is still worth believing at the sale, and refusing that
   * submission trades a booking for a form field. And the number gates
   * **nothing**: there is no agency lookup (H-10 was dropped), so it is evidence
   * for a human to pre-check and a way to catch an obvious typo. The boarding
   * sighting is unchanged, and `recordSelfDeclaredCards`' anti-displacement rule
   * still does the safety work — a claim never touches a real card.
   *
   * `.catch(undefined)` on both: an unparseable value is silence, exactly like
   * an empty box. These ride on a form whose *point* is the booking, and a
   * mistyped optional field must never refuse a sale.
   */
  certificationAgency: z.enum(certificationAgency.enumValues).optional().catch(undefined),
  certificationNumber: declaredCardNumberSchema.optional().catch(undefined),
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
  /**
   * The agency and number the diver typed beside their level, when they gave
   * them. Both absent unless a real level was picked — the two fields are
   * about a card, and there is no card to describe under "I'm not certified
   * yet" or "Rather not say".
   */
  agency?: CertificationAgency;
  identifier?: string;
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
    certificationAgency: formData.get("certificationAgency") || undefined,
    certificationNumber: formData.get("certificationNumber") || undefined,
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
  const level = answer === NO_CERTIFICATION_ANSWER ? undefined : answer;
  // **The card fields ride with the level, and fall with it.** The form reveals
  // them only once a real rung is picked, but a hand-crafted post can send them
  // beside "I'm not certified yet" or beside nothing at all — an agency and a
  // number describing a card the same submission says does not exist. Dropped
  // here rather than downstream, so nothing after this parse ever has to
  // arbitrate a contradiction the UI cannot produce.
  return {
    level,
    noCertification: answer === NO_CERTIFICATION_ANSWER,
    agency: level ? parsed.certificationAgency : undefined,
    identifier: level ? parsed.certificationNumber : undefined,
    nitrox: parsed.nitroxCertified === "on",
  };
}

/**
 * **The declaration this joiner is allowed to write onto this address, right
 * now** — the parsed one, or `undefined` because the address has had its
 * share.
 *
 * The two public forms that still collect a declaration are anonymous, and
 * both are bounded per IP only. A rotating set of addresses is exactly what a
 * per-IP bucket cannot see, so `RATE_LIMITS.declarationByPerson` bounds the
 * write by the address the claim is *about* instead — see that entry for why
 * the key can only be the subject and never the submitter.
 *
 * Returning the declaration rather than a verdict is the point: there is no
 * shape of this that refuses the join. A diver must never be turned away
 * because somebody else sprayed claims at the address they typed, and a
 * dropped claim is the outcome a malformed one already gets. The two callers
 * pass the result straight into the `declaration:` field they were already
 * filling, so neither can accidentally branch on it.
 *
 * A join that said nothing spends nothing — there is no claim to write, so
 * there is no record to protect, and an honest joiner with no certification
 * answer can sign up as often as the per-IP bucket allows.
 */
export async function declarationWithinPersonBudget(
  declaration: DiveDeclaration | undefined,
  { shopId, email }: { shopId: string; email: string },
): Promise<DiveDeclaration | undefined> {
  if (!declaration) return undefined;
  const key = rateLimitKey("declaration", shopId, email.trim().toLowerCase());
  return (await checkRateLimit(key, RATE_LIMITS.declarationByPerson)).allowed
    ? declaration
    : undefined;
}
