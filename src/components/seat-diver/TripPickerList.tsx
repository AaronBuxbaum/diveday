import Link from "next/link";
import type { ReactNode } from "react";

/** One departure a staffer can stand on. */
export type TripPickerOption = {
  id: string;
  href: string;
  /** Title · date · time — already formatted for the request locale and shop zone. */
  label: ReactNode;
  /** The right-hand column: seats left, or booked/capacity. */
  meta: ReactNode;
};

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
            className="flex min-h-11 items-baseline justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3 text-sm font-medium hover:border-primary/40"
          >
            <span className="min-w-0 flex-1">{option.label}</span>
            <span className="shrink-0 tabular-nums text-muted">{option.meta}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
