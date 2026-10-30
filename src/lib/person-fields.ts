import { z } from "zod";

/**
 * Shared name, email, and phone length bounds preserve the widest values
 * previously accepted by any form.
 *
 * These fragments define bounds, not error copy. Each surface chooses whether
 * fields are required or blankable and keeps its own error keys.
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
 * Digits-only normalization lets differently formatted phone values compare
 * consistently across person search, inbox matching, and duplicate checks.
 */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** A query worth comparing as a phone number at all — see `phoneDigits`. */
export const MIN_PHONE_SEARCH_DIGITS = 4;

/** Classifies a query as email, phone, or name for form prefill. */
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
  const digits = phoneDigits(trimmed);
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
    /** The departure door's counter mode: a walk-in on a boat that has not left. */
    walkIn?: boolean;
    tripId?: string;
    waitlist?: boolean;
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
  if (params?.walkIn) search.set("walkIn", "true");
  if (params?.tripId) search.set("tripId", params.tripId);
  if (params?.waitlist) search.set("waitlist", "true");
  if (params?.request) search.set("request", params.request);
  if (params?.extra) {
    for (const [k, v] of Object.entries(params.extra)) {
      if (v !== undefined) search.set(k, v);
    }
  }
  const base = `/shop/${shopSlug}/divers/new`;
  return search.size > 0 ? `${base}?${search.toString()}` : base;
}
