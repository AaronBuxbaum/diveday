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
export const blankableDiverNameSchema = z.string().trim().max(DIVER_NAME_MAX);
export const diverEmailSchema = z.email().max(DIVER_EMAIL_MAX);
export const diverPhoneSchema = z.string().trim().max(DIVER_PHONE_MAX);

/**
 * A valid email or the empty string — for the staff surfaces where an email
 * box is always rendered but a diver may genuinely not have one (the record
 * editor, hand-entered seating). Shared so the two sites can't drift on what
 * "blank" means.
 */
export const blankableDiverEmailSchema = z.union([z.literal(""), diverEmailSchema]);

/**
 * Splits or maps search query text to name, email, or phone. The command
 * palette and every seat-a-diver surface use the same prefill rule, so a
 * searched phone number does not arrive in the name field.
 */
export function diverSearchPrefill(query: string): {
  name?: string;
  email?: string;
  phone?: string;
} {
  const trimmed = query.trim();
  if (!trimmed) return {};
  if (trimmed.includes("@")) {
    return { email: trimmed };
  }
  const digits = trimmed.replace(/\D/g, "");
  // Allow the punctuation people commonly paste from contacts, including
  // non-breaking spaces and an extension. Without `\s`, a copied phone from
  // some mobile address books fell through as a diver's name and the Cmd-K
  // create flow appeared not to work.
  if (digits.length >= 7 && /^[+\d().\s/-]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(trimmed)) {
    return { phone: trimmed };
  }
  return { name: trimmed };
}

/**
 * Builds the URL to the dedicated create-diver page (/shop/[shopSlug]/divers/new)
 * prefilled with the query (name or email) and contextual params (tripId, surface, etc.).
 */
export function newDiverHref(
  shopSlug: string,
  params?: {
    query?: string;
    name?: string;
    email?: string;
    phone?: string;
    surface?: string;
    tripId?: string;
    waitlist?: boolean;
    returnTo?: string;
    request?: string;
    extra?: Record<string, string | undefined>;
  },
): string {
  const search = new URLSearchParams();
  if (params?.query) {
    const prefill = diverSearchPrefill(params.query);
    if (prefill.email) search.set("email", prefill.email);
    if (prefill.name) search.set("name", prefill.name);
    if (prefill.phone) search.set("phone", prefill.phone);
  }
  if (params?.name) search.set("name", params.name);
  if (params?.email) search.set("email", params.email);
  if (params?.phone) search.set("phone", params.phone);
  if (params?.surface) search.set("surface", params.surface);
  if (params?.tripId) search.set("tripId", params.tripId);
  if (params?.waitlist) search.set("waitlist", "true");
  if (params?.returnTo) search.set("returnTo", params.returnTo);
  if (params?.request) search.set("request", params.request);
  if (params?.extra) {
    for (const [k, v] of Object.entries(params.extra)) {
      if (v !== undefined) search.set(k, v);
    }
  }
  const base = `/shop/${shopSlug}/divers/new`;
  return search.size > 0 ? `${base}?${search.toString()}` : base;
}
