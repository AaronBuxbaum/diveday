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

/** Mailbox providers known to ignore dots in the local part. */
const DOTLESS_MAILBOX_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The mailbox an address delivers to, as a comparison key, or null when there
 * is nothing to compare.
 *
 * Two active records can never share an address outright (`people_shop_email_
 * unique` is case-insensitive), so an exact match is never the duplicate a
 * shop meets. The ones it does meet are one mailbox written two ways: a
 * `+dive` tag on one booking and not the other, or `maya.rivera@gmail.com`
 * beside `mayarivera@gmail.com`. So the key drops a `+tag` everywhere and the
 * dots only where the provider is known to ignore them. Nothing else is
 * guessed: a typo in the domain is a different mailbox, and only staff can say
 * otherwise.
 */
export function emailMatchKey(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (DOTLESS_MAILBOX_DOMAINS.has(domain)) local = local.replaceAll(".", "");
  return local ? `${local}@${domain}` : null;
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

/** Whether a pair's likeness rests on the name alone, with no contact detail agreeing. */
export function matchRestsOnNameAlone(a: DuplicateSignals, b: DuplicateSignals): boolean {
  const reasons = diverDuplicateReasons(a, b);
  return !reasons.includes("same_email") && !reasons.includes("same_phone");
}
