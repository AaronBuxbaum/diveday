import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { StaffScheduleTrip } from "@/db/trips";
import { formatShortDate, formatTimeRange } from "@/lib/format";

function roleLabel(role: string) {
  return role === "divemaster" ? "DM" : role === "instructor" ? "Instructor" : role;
}

export function StaffScheduleBoard({
  shopSlug,
  trips,
  timezone,
}: {
  shopSlug: string;
  trips: StaffScheduleTrip[];
  timezone: string;
}) {
  return (
    <section aria-label="Staff schedule" className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Staff schedule</h2>
          <p className="mt-1 text-sm text-muted">
            Everyone’s assignments, including each day of a multi-day course.
          </p>
        </div>
        <Badge tone="neutral">Double-booking protected</Badge>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <ul className="divide-y divide-border">
          {trips.map((trip) => (
            <li key={trip.id} className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/shop/${shopSlug}/trips/${trip.id}`}
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {trip.title}
                  </Link>
                  {trip.courseTitle ? (
                    <p className="mt-0.5 text-sm text-primary">Course · {trip.courseTitle}</p>
                  ) : null}
                </div>
                <div className="shrink-0 text-sm text-muted">
                  {formatShortDate(trip.startsAt, "en-US", timezone)}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {trip.days.map((day) => (
                  <div
                    key={day.dayNumber}
                    className={"rounded-xl border border-border bg-surface-sunken/40 p-3"}
                  >
                    <p className="text-xs font-semibold tracking-wide text-muted uppercase">
                      {trip.days.length > 1 ? `Day ${day.dayNumber}` : "Schedule"}
                    </p>
                    <p className="mt-1 text-sm font-medium tabular-nums">
                      {formatShortDate(day.startsAt, "en-US", timezone)} ·{" "}
                      {formatTimeRange(day.startsAt, day.endsAt, "en-US", timezone)}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold tracking-wide text-muted uppercase">
                  Crew
                </span>
                {trip.crew.length > 0 ? (
                  trip.crew.map((member) => (
                    <span
                      key={member.id}
                      className={"rounded-full border border-border px-2.5 py-1 text-xs"}
                    >
                      {member.name} · {member.roles.map(roleLabel).join(" / ")}
                    </span>
                  ))
                ) : (
                  <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                    No crew assigned
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
