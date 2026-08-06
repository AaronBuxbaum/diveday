import Link from "next/link";

/**
 * "This is the boat you picked, and here is the way back to the list" — the
 * card both trip-first doors (the counter walk-in, the global Add-booking step
 * two) stand under while they choose a diver.
 *
 * The summary sentence arrives already formatted: dates and money are the
 * page's job, because only it knows the shop's timezone and the negotiated
 * request locale (AGENTS.md — a rendered date names the zone it is rendered in).
 */
export function SelectedTripCard({
  label,
  summary,
  changeHref,
  changeLabel,
  className = "",
}: {
  label: string;
  summary: string;
  changeHref: string;
  changeLabel: string;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-6 ${className}`}
    >
      <p className="text-xs font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-semibold">{summary}</p>
      <Link
        href={changeHref}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {changeLabel}
      </Link>
    </section>
  );
}
