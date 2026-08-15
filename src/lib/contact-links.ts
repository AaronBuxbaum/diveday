/**
 * How the app turns a shop's or a diver's stored contact details into a link a
 * phone can act on.
 *
 * This exists because `tel:` is not a format a stored string is already in. A
 * shop types its number the way it prints it — "+1 (305) 555-0134" — and a
 * `tel:` URI carrying spaces and parentheses is refused outright by several
 * diallers, so the tap does nothing on the one surface (a diver on a dock,
 * looking for the boat) where it most needs to work. Two call sites shipped
 * the raw string straight into the href for exactly that reason: the sanitizing
 * version lived in `course-inquiry.ts`, a domain module nobody rendering a
 * header thought to look in, so two of the four call sites hand-copied the
 * regex and two never found it at all.
 *
 * So it lives here instead, named for what it is rather than for the one
 * feature that happened to need it first.
 */

/** Digits only, so a printed number like "+1 (305) 555-0134" still dials. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * A `mailto:` with an optional prefilled subject and body.
 *
 * The address itself is deliberately *not* encoded: an email address's legal
 * characters are already legal in a `mailto:` path, and encoding the `@` is
 * what makes a link open a blank compose window in some clients. The subject
 * and body are query parameters and are encoded, which is where a shop's own
 * words (an apostrophe, an accent, a `&`) would otherwise truncate the draft.
 */
export function mailtoHref(email: string, options?: { subject?: string; body?: string }): string {
  const query = new URLSearchParams();
  if (options?.subject) query.set("subject", options.subject);
  if (options?.body) query.set("body", options.body);
  const search = query.toString();
  // `URLSearchParams` renders a space as `+`, which a mailto body shows
  // literally; `%20` is what every client agrees on.
  return `mailto:${email}${search ? `?${search.replace(/\+/g, "%20")}` : ""}`;
}
