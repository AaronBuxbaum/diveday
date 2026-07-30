"use client";

import Link from "next/link";
import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";

/** One departure as the board hands it to the builder, already shop-local. */
export type BuilderTrip = {
  id: string;
  title: string;
  /** `YYYY-MM-DD` in the shop's timezone — the grouping key and the date input's value. */
  dateIso: string;
  /** `HH:mm` in the shop's timezone. */
  startTime: string;
  /** Preformatted for the shop's locale; the client never re-formats a time. */
  timeRange: string;
  capacity: number;
  booked: number;
  courseTitle: string | null;
  diveSiteName: string | null;
  /** A multi-day course moves as a block; the builder says so before it does. */
  dayCount: number;
  /** Who is crewing it — the board's other question, answered in place. */
  crew: string[];
};

export type BuilderDay = {
  dateIso: string;
  /** Preformatted for the shop's locale, e.g. "Tue, Jul 21". */
  label: string;
  trips: BuilderTrip[];
};

export type BuilderOption = { id: string; title: string };

type BuilderActions = {
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  add: (formData: FormData) => void | Promise<void>;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  move: (formData: FormData) => void | Promise<void>;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  duplicate: (formData: FormData) => void | Promise<void>;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  remove: (formData: FormData) => void | Promise<void>;
};

/**
 * Every word the builder shows, resolved server-side from the staff bundle
 * (`staffTranslator`, since this is a Client Component and cannot translate
 * itself). Values that vary per day or per trip stay as `{placeholder}`
 * templates and are filled in at render time with `fill` below — the
 * template text itself is still a fully-translated, complete sentence, never
 * a prefix/suffix pair assembled from parts.
 */
export type BuilderCopy = {
  heading: string;
  description: string;
  ariaLabel: string;
  addDeparture: string;
  addDepartureOnDay: string;
  add: string;
  cancel: string;
  noSiteSetYet: string;
  courseLabel: string;
  dayCountLabel: string;
  crewLabel: string;
  crewNobodyYet: string;
  move: string;
  moveAria: string;
  copy: string;
  copyAria: string;
  remove: string;
  removeAria: string;
  removeConfirm: string;
  removePending: string;
  whatIsIt: string;
  titlePlaceholder: string;
  date: string;
  departs: string;
  returns: string;
  seats: string;
  dives: string;
  course: string;
  optional: string;
  diveSite: string;
  ordinaryTrip: string;
  decideLater: string;
  adding: string;
  putOnBoard: string;
  newDate: string;
  multiDayNote: string;
  newDepartureTime: string;
  moving: string;
  moveIt: string;
  copyTo: string;
  copyDescription: string;
  departureTime: string;
  copying: string;
  copyIt: string;
};

/** `YYYY-MM-DD`, `offsetDays` from the given ISO day, without touching the clock. */
function shiftIsoDay(dateIso: string, offsetDays: number): string {
  const shifted = new Date(`${dateIso}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
}

/** Fills `{placeholder}` tokens in a server-supplied template with per-row values. */
function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * The staff schedule board, as a builder rather than a list.
 *
 * Departures sit under the shop-local day they sail on, and each row carries its
 * own controls: slide it to another day or time, copy it forward, or take it
 * back off the board. "Add a departure" opens under whichever day header the
 * staff member pressed it on, pre-dated to that day, so putting a second boat on
 * Thursday is one click and a title rather than a trip through a full form.
 *
 * Only one panel is open at a time. That is not just tidiness: every panel is a
 * separate `<form>` posting a whole edit, and two open at once invites a staff
 * member to fill in both and lose the one they didn't submit.
 *
 * Everything past when-and-how-many — dives, sites, requirements, crew,
 * conditions, prices, the roster — stays on the trip's own page, one click away
 * on the title. This surface is deliberately shallow.
 */
export function ScheduleBuilder({
  shopSlug,
  days,
  courses,
  diveSites,
  actions,
  defaultDateIso,
  canConfigure,
  copy,
}: {
  shopSlug: string;
  days: BuilderDay[];
  courses: BuilderOption[];
  diveSites: BuilderOption[];
  actions: BuilderActions;
  /** The soonest day on the board, for the "Add a departure" button in the header. */
  defaultDateIso: string;
  canConfigure: boolean;
  copy: BuilderCopy;
}) {
  // One of `add:<dateIso>`, `move:<tripId>`, `copy:<tripId>`, or null.
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (panel: string) => setOpen((current) => (current === panel ? null : panel));

  function AddPanel({ dateIso }: { dateIso: string }) {
    return (
      <FieldGrid
        as="form"
        action={actions.add}
        columns={1}
        className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4"
      >
        <Field label={copy.whatIsIt}>
          <input
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder={copy.titlePlaceholder}
            className={controlClass}
          />
        </Field>
        <FieldGrid columns={3} className="gap-y-4">
          <Field label={copy.date}>
            <input
              name="date"
              type="date"
              required
              defaultValue={dateIso}
              className={controlClass}
            />
          </Field>
          <Field label={copy.departs}>
            <input
              name="startTime"
              type="time"
              required
              defaultValue="08:30"
              className={controlClass}
            />
          </Field>
          <Field label={copy.returns}>
            <input
              name="endTime"
              type="time"
              required
              defaultValue="12:30"
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-4">
          <Field label={copy.seats}>
            <input
              name="capacity"
              type="number"
              required
              min={1}
              max={60}
              defaultValue={12}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
          <Field label={copy.dives}>
            <input
              name="plannedDives"
              type="number"
              required
              min={1}
              max={4}
              defaultValue={2}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-4">
          <Field label={copy.course} hint={copy.optional}>
            <select name="courseId" defaultValue="" className={controlClass}>
              <option value="">{copy.ordinaryTrip}</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label={copy.diveSite} hint={copy.optional}>
            <select name="diveSiteId" defaultValue="" className={controlClass}>
              <option value="">{copy.decideLater}</option>
              {diveSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.title}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel={copy.adding} className={buttonClass()}>
            {copy.putOnBoard}
          </SubmitButton>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            {copy.cancel}
          </button>
        </div>
      </FieldGrid>
    );
  }

  return (
    <section aria-label={copy.ariaLabel} className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{copy.heading}</h2>
          <p className="mt-1 text-sm text-muted">{copy.description}</p>
        </div>
        {canConfigure ? (
          <button
            type="button"
            onClick={() => toggle("add:top")}
            aria-expanded={open === "add:top"}
            className={buttonClass({ className: "rounded-xl" })}
          >
            <span aria-hidden="true">+</span> {copy.addDeparture}
          </button>
        ) : null}
      </div>

      {/* Keyed "add:top" rather than by its date: the header button and the
          first day's own "+ Add" would otherwise share a panel key and render
          two identical forms at once. */}
      {canConfigure && open === "add:top" ? <AddPanel dateIso={defaultDateIso} /> : null}

      <div className="mt-4 flex flex-col gap-5">
        {days.map((day) => (
          <div key={day.dateIso}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
              <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">
                {day.label}
              </h3>
              {canConfigure ? (
                <button
                  type="button"
                  onClick={() => toggle(`add:${day.dateIso}`)}
                  aria-expanded={open === `add:${day.dateIso}`}
                  aria-label={fill(copy.addDepartureOnDay, { day: day.label })}
                  className={buttonClass({ variant: "ghost", size: "sm" })}
                >
                  <span aria-hidden="true">+</span> {copy.add}
                </button>
              ) : null}
            </div>
            {canConfigure && open === `add:${day.dateIso}` ? (
              <AddPanel dateIso={day.dateIso} />
            ) : null}

            <ul className="mt-3 flex flex-col gap-2">
              {day.trips.map((trip) => {
                const full = trip.booked >= trip.capacity;
                // "Copy" is designed to mint a same-titled departure on another
                // day, so the title alone is never a unique accessible name for
                // these controls. Day and time make it one.
                const ref = `${trip.title}, ${day.label} ${trip.timeRange}`;
                return (
                  <li
                    key={trip.id}
                    className="rounded-2xl border border-border bg-surface p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                      <div className="w-28 shrink-0 text-sm tabular-nums text-muted">
                        {trip.timeRange}
                      </div>
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/shop/${shopSlug}/trips/${trip.id}`}
                          className="font-medium hover:text-primary"
                        >
                          {trip.title}
                        </Link>
                        <p className="mt-0.5 text-sm text-muted">
                          {[
                            trip.courseTitle
                              ? fill(copy.courseLabel, { title: trip.courseTitle })
                              : null,
                            trip.diveSiteName,
                            trip.dayCount > 1
                              ? fill(copy.dayCountLabel, { count: trip.dayCount })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || copy.noSiteSetYet}
                        </p>
                        <p className="mt-1 text-sm">
                          <span className="text-muted">{copy.crewLabel} </span>
                          {trip.crew.length > 0 ? (
                            trip.crew.join(", ")
                          ) : (
                            <span className="font-medium text-warning">{copy.crewNobodyYet}</span>
                          )}
                        </p>
                      </div>
                      <Badge tone={full ? "neutral" : "primary"} tabularNums>
                        {trip.booked}/{trip.capacity}
                      </Badge>
                      {canConfigure ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggle(`move:${trip.id}`)}
                            aria-expanded={open === `move:${trip.id}`}
                            aria-label={fill(copy.moveAria, { ref })}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {copy.move}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(`copy:${trip.id}`)}
                            aria-expanded={open === `copy:${trip.id}`}
                            aria-label={fill(copy.copyAria, { ref })}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {copy.copy}
                          </button>
                          <form action={actions.remove}>
                            <input type="hidden" name="tripId" value={trip.id} />
                            <SubmitButton
                              pendingLabel={copy.removePending}
                              ariaLabel={fill(copy.removeAria, { ref })}
                              confirmMessage={fill(copy.removeConfirm, { title: trip.title })}
                              className={buttonClass({ variant: "danger", size: "sm" })}
                            >
                              {copy.remove}
                            </SubmitButton>
                          </form>
                        </div>
                      ) : null}
                    </div>

                    {canConfigure && open === `move:${trip.id}` ? (
                      <FieldGrid
                        as="form"
                        action={actions.move}
                        columns={2}
                        className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4"
                      >
                        <input type="hidden" name="tripId" value={trip.id} />
                        <Field
                          label={copy.newDate}
                          description={
                            trip.dayCount > 1
                              ? fill(copy.multiDayNote, { count: trip.dayCount })
                              : undefined
                          }
                        >
                          <input
                            name="date"
                            type="date"
                            required
                            defaultValue={trip.dateIso}
                            className={controlClass}
                          />
                        </Field>
                        <Field label={copy.newDepartureTime}>
                          <input
                            name="startTime"
                            type="time"
                            required
                            defaultValue={trip.startTime}
                            className={controlClass}
                          />
                        </Field>
                        <div className="flex items-center gap-3 sm:col-span-2">
                          <SubmitButton pendingLabel={copy.moving} className={buttonClass()}>
                            {copy.moveIt}
                          </SubmitButton>
                          <button
                            type="button"
                            onClick={() => setOpen(null)}
                            className="text-sm font-medium text-muted hover:text-foreground"
                          >
                            {copy.cancel}
                          </button>
                        </div>
                      </FieldGrid>
                    ) : null}

                    {canConfigure && open === `copy:${trip.id}` ? (
                      <FieldGrid
                        as="form"
                        action={actions.duplicate}
                        columns={2}
                        className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4"
                      >
                        <input type="hidden" name="tripId" value={trip.id} />
                        <Field label={copy.copyTo} description={copy.copyDescription}>
                          <input
                            name="date"
                            type="date"
                            required
                            defaultValue={shiftIsoDay(trip.dateIso, 7)}
                            className={controlClass}
                          />
                        </Field>
                        <Field label={copy.departureTime}>
                          <input
                            name="startTime"
                            type="time"
                            required
                            defaultValue={trip.startTime}
                            className={controlClass}
                          />
                        </Field>
                        <div className="flex items-center gap-3 sm:col-span-2">
                          <SubmitButton pendingLabel={copy.copying} className={buttonClass()}>
                            {copy.copyIt}
                          </SubmitButton>
                          <button
                            type="button"
                            onClick={() => setOpen(null)}
                            className="text-sm font-medium text-muted hover:text-foreground"
                          >
                            {copy.cancel}
                          </button>
                        </div>
                      </FieldGrid>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
