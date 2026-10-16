import { z } from "zod";
import { formValue, readForm, text } from "@/lib/form-parse";
import { uuidParam } from "@/lib/uuid";

/**
 * Every field the card forms post, each read as `FormData.get` read it: the
 * schemas above, and the review rules below, are what narrow them.
 */
export const cardForm = z.object({
  agency: formValue(),
  card: text(),
  cardType: formValue(),
  certificationId: text(),
  identifier: formValue(),
  intent: formValue(),
  pageText: formValue(),
  refresh: formValue(),
  reviewedAt: formValue(),
  sightedAgency: formValue(),
  sightedIdentifier: formValue(),
  sightedLevel: formValue(),
});

/**
 * The card a submit names, narrowed to something a `uuid` column can actually
 * be compared against — or `undefined`, which every caller below already
 * handles as "no card named" and answers with its own refusal.
 *
 * Five actions took this straight off the form and put it in
 * `eq(certifications.id, …)`. **Postgres does not coerce a malformed uuid
 * literal — it raises**, so a signed-in staffer editing the posted value turned
 * a delete, a restore or a review into a **500** where that action's own
 * "invalid" belongs one line later. Tenant isolation was never the exposure
 * (every one of those queries is narrowed by `shopId` either way); a staff
 * surface answering a typo with a stack trace instead of a sentence is.
 *
 * It is the same rule and the same helper `pnpm check:repo` already enforces on
 * dynamic route segments (`scripts/check-uuid-segments.mjs`); that script can
 * only see paths, and an id posted in a hidden field reaches the identical
 * query.
 */
export function cardIdFromForm(formData: FormData): string | undefined {
  const fields = readForm(cardForm, formData);
  return uuidParam(fields.certificationId);
}
