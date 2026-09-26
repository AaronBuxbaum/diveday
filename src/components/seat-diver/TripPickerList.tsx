import Link from "next/link";
import type { ReactNode } from "react";

/** One departure a staffer can stand on. */
export type TripPickerOption = {
  id: string;
  href: string;
  /** The departure's name, as the shop wrote it. */
  title: string;
  /** When it leaves — already formatted for the request locale and shop zone. */
  when: string;
  /** The right-hand column: seats left, or booked/capacity. */
  meta: ReactNode;
};

/**
 * The separator after a title, bound to it (pixel-craft class 8, K-525): a
 * no-break space before the dot, so a long title that wraps never opens its
 * next line on "·". The space after it still breaks, so the time may start a
 * line. By code point, because a literal one is invisible in the source.
 */
const TITLE_SEPARATOR = `${String.fromCodePoint(0x00a0)}·`;

/**
 * "Which boat?" — the departure picker both the counter walk-in and the global
 * Add-booking door open with.
 *
 * The title wraps inside its own column rather than pushing the seat count onto
 * a second line: a list scanned for "where does this diver fit" needs its
 * numbers in one straight, right-aligned run. Sharing the row means the counter
 * gets that too, instead of the two lists drifting on alignment as they had.
 */
export function TripPickerList({
  options,
  className = "",
}: {
  options: TripPickerOption[];
  className?: string;
}) {
  return (
    <ul className={`flex flex-col gap-2 ${className}`}>
      {options.map((option) => (
        <li key={option.id}>
          <Link
            href={option.href}
            className="flex min-h-11 items-baseline justify-between gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3 text-sm font-medium hover:border-primary/40"
          >
            {/* Separate text nodes rather than one joined string: text is
                shaped per DOM text node, so joining them re-kerns across the
                old boundaries and shifts glyphs sub-pixel. */}
            <span className="min-w-0 flex-1">
              {option.title}
              {TITLE_SEPARATOR} {option.when}
            </span>
            <span className="shrink-0 tabular-nums text-muted">{option.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
