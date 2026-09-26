import Link from "next/link";
import { tapTargetLinkClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";

/** A request row already reduced to words by the server page. */
export type BookingRequestCardItem = {
  id: string;
  name: string;
  subject: string;
  diversLabel: string;
  dateLabel?: string;
  href: string;
};

/** The request that led a staffer into the booking flow. */
export function BookingRequestContext({
  title,
  name,
  diversLabel,
  subject,
  sourceHref,
  sourceLabel,
  personHref,
  personLabel,
  className = "",
}: {
  title: string;
  name: string;
  diversLabel: string;
  subject: string;
  sourceHref: string;
  sourceLabel: string;
  personHref?: string;
  personLabel?: string;
  className?: string;
}) {
  return (
    <SectionCard className={className} padding="lg">
      <p className="text-xs font-bold tracking-wide text-primary uppercase">{title}</p>
      <p className={`mt-2 ${SECTION_TITLE_CLASS}`}>
        {name} <span className="font-normal text-muted">({diversLabel})</span>
      </p>
      <p className="mt-1 text-sm text-muted">{subject}</p>
      {/* 44px targets, whose boxes carry the 12px above the words that `mt-3`
          used to, and the air between wrapped lines. */}
      <div className="flex flex-wrap gap-x-4 gap-y-0 text-sm font-medium">
        <Link href={sourceHref} className={`${tapTargetLinkClass} text-primary hover:underline`}>
          {sourceLabel}
        </Link>
        {personHref && personLabel ? (
          <Link href={personHref} className={`${tapTargetLinkClass} text-primary hover:underline`}>
            {personLabel}
          </Link>
        ) : null}
      </div>
    </SectionCard>
  );
}

/** Requests matched to the departure or departures currently on screen. */
export function RelevantBookingRequests({
  title,
  description,
  items,
  openLabel,
  className = "",
}: {
  title: string;
  description?: string;
  items: BookingRequestCardItem[];
  openLabel: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <SectionCard title={title} description={description} className={className} padding="lg">
      <ul className="grid gap-2">
        {/* From `sm` up a row never wraps: the words take the width and wrap
            themselves, so "Book from this request" stays at the row's right on
            every row instead of dropping under the one whose words ran long.
            On a phone the link wraps under the words, and its 44px box is the
            air between them. */}
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0 rounded-inset border border-border bg-surface-sunken px-4 py-3 sm:flex-nowrap"
          >
            <div className="min-w-0 sm:flex-1">
              <p className="font-medium">
                {item.name} <span className="font-normal text-muted">({item.diversLabel})</span>
              </p>
              <p className="text-sm text-muted">
                {item.subject}
                {item.dateLabel ? <> · {item.dateLabel}</> : null}
              </p>
            </div>
            <Link
              href={item.href}
              className={`${tapTargetLinkClass} shrink-0 text-sm font-medium text-primary hover:underline`}
            >
              {openLabel}
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
