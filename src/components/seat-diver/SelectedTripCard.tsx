import Link from "next/link";
import { SectionCard } from "@/components/ui/card";

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
    // No `title`: the label above the summary is an uppercase eyebrow, not the
    // section's heading — the page the card stands under owns that.
    <SectionCard className={className}>
      <p className="text-xs font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-1 font-semibold">{summary}</p>
      <Link
        href={changeHref}
        className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
      >
        {changeLabel}
      </Link>
    </SectionCard>
  );
}
