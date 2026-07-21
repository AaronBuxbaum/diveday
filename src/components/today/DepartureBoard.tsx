import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { DepartureSummary } from "@/db/today";
import { formatTime, formatTimeRange } from "@/lib/format";

/**
 * A count that has to be read at a glance in sunlight: big, tabular, and
 * labelled in words so the tone is never the only signal.
 */
function Count({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "danger" | "primary";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <p className="text-xs font-bold tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function DepartureCard({
  departure,
  shopSlug,
  timeZone,
}: {
  departure: DepartureSummary;
  shopSlug: string;
  timeZone: string;
}) {
  const { blocked, ready, boarded, booked, capacity } = departure;
  return (
    <li className="rounded-2xl border border-border bg-surface-sunken p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-2xl font-bold tracking-tight tabular-nums">
            {formatTime(departure.startsAt, "en-US", timeZone)}
          </p>
          <h3 className="mt-0.5 font-semibold">{departure.title}</h3>
          {departure.courseTitle ? (
            <p className="text-sm font-medium text-primary">
              Course session · {departure.courseTitle}
            </p>
          ) : null}
          <p className="text-sm text-muted">
            {formatTimeRange(departure.startsAt, departure.endsAt, "en-US", timeZone)} ·{" "}
            <span className="tabular-nums">
              {booked} of {capacity} booked
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}/boarding`}
            className={buttonClass()}
          >
            Boarding
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}/manifest`}
            className={buttonClass({ variant: "secondary" })}
          >
            Open manifest
          </Link>
          <Link
            href={`/shop/${shopSlug}/trips/${departure.tripId}`}
            className={buttonClass({ variant: "secondary" })}
          >
            Open roster
          </Link>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Count label="Ready" value={ready} tone={ready > 0 ? "success" : "default"} />
        <Count label="Blocked" value={blocked} tone={blocked > 0 ? "danger" : "default"} />
        <Count label="Boarded" value={boarded} tone={boarded > 0 ? "primary" : "default"} />
      </div>
      {blocked > 0 ? (
        <p className="mt-3 text-sm font-semibold text-danger">
          <span aria-hidden="true">⚠ </span>
          {blocked} {blocked === 1 ? "diver cannot" : "divers cannot"} board yet — they are in the
          list below.
        </p>
      ) : booked === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No one&apos;s booked yet — share the trip page and they&apos;ll show up here.
        </p>
      ) : (
        <p className="mt-3 text-sm font-semibold text-success">
          <span aria-hidden="true">✓ </span>
          Everyone aboard this trip is clear to board.
        </p>
      )}
    </li>
  );
}

/**
 * The situational-awareness strip: only boats that sail today, because a
 * departure three weeks out is a Schedule question, not a Today question.
 */
export function DepartureBoard({
  departures,
  shopSlug,
  timeZone,
}: {
  departures: readonly DepartureSummary[];
  shopSlug: string;
  timeZone: string;
}) {
  if (departures.length === 0) return null;
  return (
    <section aria-labelledby="departures-heading" className="mb-10">
      <h2 id="departures-heading" className="text-lg font-semibold">
        Sailing today
      </h2>
      <p className="mt-1 text-sm text-muted">
        Check divers in at the counter or run roll call from the manifest — readiness is rechecked
        the moment you board someone.
      </p>
      <ul className="mt-4 flex flex-col gap-3">
        {departures.map((departure) => (
          <DepartureCard
            key={departure.tripId}
            departure={departure}
            shopSlug={shopSlug}
            timeZone={timeZone}
          />
        ))}
      </ul>
    </section>
  );
}
