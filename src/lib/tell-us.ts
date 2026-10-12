/**
 * **"Tell us": a staffer's note to DiveDay, already addressed.**
 *
 * A `mailto:` link rather than a form: the staffer's own mail app sends it, so
 * the reply comes back to a person they can see, and DiveDay stores nothing
 * new. The prefill carries exactly two facts, the shop's slug and the page's
 * path, because "which page were you on?" is the first question support would
 * otherwise ask. The path is taken without its query string or fragment: a
 * search box or a filter can put a diver's name there, and nothing personal
 * belongs in a message the staffer did not write.
 */
export type TellUsMailtoInput = {
  /** Where the message goes: `SUPPORT_EMAIL` (src/lib/platform-mail.ts). */
  to: string;
  subject: string;
  /** The body's opening line, already holding the path. */
  body: string;
};

/** The page's path alone: no query string, no fragment. */
export function tellUsPath(pathname: string): string {
  const cut = pathname.search(/[?#]/);
  const path = cut === -1 ? pathname : pathname.slice(0, cut);
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * A `mailto:` URL with a subject and a body. Encoded with
 * `encodeURIComponent`, which writes a space as `%20`: RFC 6068 asks for that,
 * and mail apps that see `+` (the form encoding) show it literally.
 */
export function tellUsMailto({ to, subject, body }: TellUsMailtoInput): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
