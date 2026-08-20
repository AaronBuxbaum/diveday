import Link from "next/link";
import { SectionCard } from "@/components/ui/card";

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
      <p className="mt-2 text-lg font-semibold tracking-tight">
        {name} <span className="font-normal text-muted">({diversLabel})</span>
      </p>
      <p className="mt-1 text-sm text-muted">{subject}</p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium">
        <Link href={sourceHref} className="text-primary hover:underline">
          {sourceLabel}
        </Link>
        {personHref && personLabel ? (
          <Link href={personHref} className="text-primary hover:underline">
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
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-sunken px-4 py-3"
          >
            <div className="min-w-0">
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
              className="shrink-0 text-sm font-medium text-primary hover:underline"
            >
              {openLabel}
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}
