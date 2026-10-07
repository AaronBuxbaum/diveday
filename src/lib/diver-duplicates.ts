import { MIN_PHONE_SEARCH_DIGITS, phoneDigits } from "@/lib/person-fields";
import { normalizePersonName } from "@/lib/person-name";

/** The fields a likely-duplicate check reads off a diver record. */
export type DuplicateSignals = {
  fullName: string;
  email: string | null;
  phone: string | null;
  /** `YYYY-MM-DD`, as the column stores it. */
  dateOfBirth: string | null;
};

export type DiverDuplicateReason =
  | "same_email"
  | "same_phone"
  | "same_name_and_birth_date"
  | "same_name";

/**
 * The address as a comparison key — trimmed and lowercased, nothing else — or
 * null when there is nothing to compare.
 *
 * **No `+tag` stripping and no dot folding** (visual triage of #2218,
 * 2026-10-07). Stripping a tag made every seeded `success+<name>@…` diver a
 * "Same email" duplicate of every other, and a real shop meets the same shape
 * whenever a parent books the family as `parent+kid@…`: a false "Same email"
 * invites merging a parent and a child, the one merge this feature must never
 * invite. A plus-variant is a different address as far as this hint goes;
 * staff can still compare any two records by hand.
 *
 * Two live records cannot hold the identical address
 * (`people_shop_email_unique`), so this reason mostly fires against a record
 * whose address was typed with different case or spacing on import.
 */
export function emailMatchKey(email: string | null | undefined): string | null {
  const key = (email ?? "").trim().toLowerCase();
  const at = key.lastIndexOf("@");
  if (at <= 0 || at === key.length - 1) return null;
  return key;
}

/** Digits of a phone long enough to mean anything, or null. */
export function phoneMatchKey(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone ?? "");
  return digits.length >= MIN_PHONE_SEARCH_DIGITS ? digits : null;
}

/**
 * Why two records look like one diver, strongest first; empty when they do
 * not. Exact keys only: a likely duplicate is a hint a staffer reads before
 * choosing, never a merge.
 *
 * **A name alone is never enough** (dive-domain review, 2026-10-07): a parent
 * and the child named after them share a name, and a merge would hand the
 * child the parent's card and releases. So the name counts only with a second
 * signal beside it. The same name and the same date of birth is one; the same
 * name with a date missing on either side is offered only when the email or
 * the phone agrees too; and the same name with two different dates is two
 * people and is not offered on the name at all.
 */
export function diverDuplicateReasons(
  a: DuplicateSignals,
  b: DuplicateSignals,
): DiverDuplicateReason[] {
  const reasons: DiverDuplicateReason[] = [];
  const emailA = emailMatchKey(a.email);
  if (emailA && emailA === emailMatchKey(b.email)) reasons.push("same_email");
  const phoneA = phoneMatchKey(a.phone);
  if (phoneA && phoneA === phoneMatchKey(b.phone)) reasons.push("same_phone");
  const nameA = normalizePersonName(a.fullName);
  if (nameA && nameA === normalizePersonName(b.fullName)) {
    if (a.dateOfBirth && b.dateOfBirth) {
      if (a.dateOfBirth === b.dateOfBirth) reasons.push("same_name_and_birth_date");
    } else if (reasons.length > 0) {
      reasons.push("same_name");
    }
  }
  return reasons;
}

/**
 * Whether a pair's likeness rests on the name alone: one name, and no email or
 * phone agreeing. False for two different names, where nothing ties the pair
 * at all and there is no namesake to mistake.
 */
export function matchRestsOnNameAlone(a: DuplicateSignals, b: DuplicateSignals): boolean {
  const name = normalizePersonName(a.fullName);
  if (!name || name !== normalizePersonName(b.fullName)) return false;
  const reasons = diverDuplicateReasons(a, b);
  return !reasons.includes("same_email") && !reasons.includes("same_phone");
}
