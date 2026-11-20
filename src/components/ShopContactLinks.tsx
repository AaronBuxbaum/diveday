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
 *
 * **A thumb can press them because each is a 44px target** (`tapTargetLinkClass`).
 * They were 20px words, on the trip page and the arrival card, in the one
 * component whose purpose is to be pressed. The row aligns on the baseline, so
 * the separator still sits on the words' line inside the taller boxes.
 */
import { tapTargetLinkClass } from "@/components/ui/button";
import { mailtoHref, telHref } from "@/lib/contact-links";

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
  const linkClass = `${tapTargetLinkClass} font-medium text-primary hover:underline`;
  return (
    // `overflow-x-clip`: the dot sits in the gap before the email, so when the
    // email wraps under the phone its dot falls outside the row's start edge
    // and is clipped; no line starts or ends on a "·" (phone polish,
    // 2026-11-20). The clip is horizontal only, so a caller's `-my-3` still
    // lets the 44px targets overhang the line.
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 overflow-x-clip ${className}`}>
      {phone ? (
        // A dialler takes digits and a leading `+`, never the spaces, dashes,
        // and parentheses a shop types into the settings box — the visible
        // text stays exactly what they wrote.
        <a href={telHref(phone)} className={linkClass}>
          {phone}
        </a>
      ) : null}
      {email ? (
        <span className="relative inline-flex min-w-0 items-baseline">
          {phone ? (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 -start-2 flex w-2 items-center justify-center"
            >
              ·
            </span>
          ) : null}
          {/* `wrap-anywhere`: a tap-target link is a flex box, whose narrowest
              width is the whole address unless it may break inside it. */}
          <a href={mailtoHref(email)} className={`${linkClass} min-w-0 wrap-anywhere`}>
            {email}
          </a>
        </span>
      ) : null}
    </span>
  );
}
