/**
 * How to reach the shop, as things a thumb can actually press.
 *
 * Every diver-facing "ask the shop" line used to pick *one* contact —
 * `shop.contactEmail || shop.contactPhone` — and print it as plain text. That
 * is two failures in one line: a shop that published both had half of it
 * hidden, and the half that survived was a string to copy out by hand on the
 * exact surface (a phone, mid-booking) where tapping it should have started
 * the call.
 *
 * Both are shown when both exist, each as its own link, in the order a diver
 * with a question actually reaches for them. Renders nothing when the shop has
 * published neither — the sentence that introduces it stands alone rather than
 * trailing an empty separator.
 */
export function ShopContactLinks({
  phone,
  email,
  className = "",
}: {
  phone: string | null;
  email: string | null;
  className?: string;
}) {
  if (!phone && !email) return null;
  const linkClass = "font-medium text-primary hover:underline";
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
      {phone ? (
        // A dialler takes digits and a leading `+`, never the spaces, dashes,
        // and parentheses a shop types into the settings box — the visible
        // text stays exactly what they wrote.
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={linkClass}>
          {phone}
        </a>
      ) : null}
      {phone && email ? <span aria-hidden="true">·</span> : null}
      {email ? (
        <a href={`mailto:${email}`} className={linkClass}>
          {email}
        </a>
      ) : null}
    </span>
  );
}
