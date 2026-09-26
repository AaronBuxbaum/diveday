/**
 * **A date or a time is one unit on the line.**
 *
 * `Intl.DateTimeFormat` hands back ICU's pattern with an ordinary space — V8
 * turns ICU's U+202F into U+0020 — before the day period, between month and
 * day, and before the zone. Every caller that printed one in wrapping text
 * could split it: "7:05 / AM EDT" in the departure log's buddy cells, "Jul /
 * 21" on a certification line, "12:00 / PM" on the rental ticket (pixel-craft
 * class 8, "a time and its meridiem" is its first example).
 *
 * So the formatters join their `formatToParts` output here, and a literal that
 * is nothing but space becomes U+00A0. A literal with anything else in it — the
 * ", " after a weekday or between a date and a time, a range's " – " — keeps
 * its breaking space, which is where a line may still end.
 *
 * Text that leaves the page does not wrap, and one channel pays for the
 * character: the SMS transport turns it back into a plain space
 * (`src/lib/notifications/sms.ts`).
 */
export function keepUnitsWhole(parts: readonly { type: string; value: string }[]): string {
  return parts
    .map((part) => (part.type === "literal" && /^\s+$/.test(part.value) ? " " : part.value))
    .join("");
}
