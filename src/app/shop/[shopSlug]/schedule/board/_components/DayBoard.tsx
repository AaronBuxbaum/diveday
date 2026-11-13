"use client";

import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DateField, Field } from "@/components/ui/form";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { readScheduleDay } from "@/features/schedule-day";
import { fill } from "@/i18n/fill";

type Row = Awaited<ReturnType<typeof readScheduleDay>>[number];
export type DayCopy = {
  day: string;
  week: string;
  chooseDay: string;
  showDay: string;
  empty: string;
  review: string;
  crew: string;
  divers: string;
  noCrew: string;
  noDivers: string;
  noBoat: string;
  standingClash: string;
  absent: string;
  identityHeld: string;
  hullClash: string;
  overCapacity: string;
  shore: string;
  pool: string;
};

type DisplayRow = Row & { time: string; totalPersonWarning: string | null };

function vessel(row: Row, copy: DayCopy) {
  return row.diveMode === "shore"
    ? copy.shore
    : row.diveMode === "pool"
      ? copy.pool
      : (row.boatName ?? copy.noBoat);
}

export function DayBoard({
  shopSlug,
  day,
  rows,
  copy,
}: {
  shopSlug: string;
  day: string;
  rows: DisplayRow[];
  copy: DayCopy;
}) {
  const path = `/shop/${shopSlug}/schedule/board`;
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Link
          href={`${path}?week=${encodeURIComponent(day)}`}
          className={buttonClass({ variant: "secondary", size: "sm" })}
        >
          {copy.week}
        </Link>
        <form action={path} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="view" value="day" />
          <Field label={copy.chooseDay} markRequired={false}>
            <DateField name="day" defaultValue={day} required />
          </Field>
          <SubmitButton
            pendingLabel={copy.showDay}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {copy.showDay}
          </SubmitButton>
        </form>
      </div>
      <p className="text-sm text-muted">{copy.review}</p>
      {rows.length === 0 ? (
        <p>{copy.empty}</p>
      ) : (
        <ol className="grid items-start gap-4 lg:grid-cols-2">
          {rows.map((row) => (
            <li key={row.tripId} className="rounded-card border border-edge p-4">
              <h2 className={SECTION_TITLE_CLASS}>
                <Link
                  className="inline-flex min-h-11 items-center"
                  href={`/shop/${shopSlug}/trips/${row.tripId}`}
                >
                  {row.title}
                </Link>
              </h2>
              <p>
                {row.time} · {vessel(row, copy)}
              </p>
              {row.boatClashes.map((clash) => (
                <p role="alert" key={clash.otherTripId} className="mt-2 text-warning-strong">
                  {fill(copy.hullClash, { boat: clash.boatName, departure: clash.otherTitle })}
                </p>
              ))}
              {row.overSellableCapacity ? (
                <p role="alert" className="mt-2 text-warning-strong">
                  {copy.overCapacity}
                </p>
              ) : null}
              {row.totalPersonWarning ? (
                <p role="alert" className="mt-2 text-warning-strong">
                  {row.totalPersonWarning}
                </p>
              ) : null}
              {row.collisions.map((clash) => {
                const name =
                  row.crew.find((member) => member.id === clash.personId)?.name ??
                  row.divers.find((seat) => seat.personId === clash.personId)?.name;
                return name ? (
                  <p
                    role="alert"
                    key={`${clash.personId}:${clash.otherTripId}`}
                    className="mt-2 text-warning-strong"
                  >
                    {fill(copy.standingClash, { name, departure: clash.otherTitle })}
                  </p>
                ) : null;
              })}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <details>
                  <summary className="cursor-pointer font-semibold">
                    {copy.crew} ({row.crew.length})
                  </summary>
                  {row.crew.length ? (
                    <ul>
                      {row.crew.map((member) => (
                        <li key={member.id} className="py-2">
                          {member.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noCrew}</p>
                  )}
                </details>
                <details>
                  <summary className="cursor-pointer font-semibold">
                    {copy.divers} ({row.divers.length})
                  </summary>
                  {row.divers.length ? (
                    <ul>
                      {row.divers.map((seat) => (
                        <li key={seat.id} className="py-2">
                          {seat.name}
                          {seat.status === "no_show" ? <span> · {copy.absent}</span> : null}
                          {seat.identityHeld ? <p>{copy.identityHeld}</p> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{copy.noDivers}</p>
                  )}
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
