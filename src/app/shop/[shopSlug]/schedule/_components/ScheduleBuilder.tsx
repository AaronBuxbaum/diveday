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
  add: (formData: FormData) => void | Promise<void>;
  move: (formData: FormData) => void | Promise<void>;
  duplicate: (formData: FormData) => void | Promise<void>;
  remove: (formData: FormData) => void | Promise<void>;
};

/** `YYYY-MM-DD`, `offsetDays` from the given ISO day, without touching the clock. */
function shiftIsoDay(dateIso: string, offsetDays: number): string {
  const shifted = new Date(`${dateIso}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offsetDays);
  return shifted.toISOString().slice(0, 10);
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
}: {
  shopSlug: string;
  days: BuilderDay[];
  courses: BuilderOption[];
  diveSites: BuilderOption[];
  actions: BuilderActions;
  /** The soonest day on the board, for the "Add a departure" button in the header. */
  defaultDateIso: string;
  canConfigure: boolean;
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
        <Field label="What is it">
          <input
            name="title"
            type="text"
            required
            maxLength={120}
            placeholder="Two-Tank Reef — Molasses & French"
            className={controlClass}
          />
        </Field>
        <FieldGrid columns={3} className="gap-y-4">
          <Field label="Date">
            <input
              name="date"
              type="date"
              required
              defaultValue={dateIso}
              className={controlClass}
            />
          </Field>
          <Field label="Departs">
            <input
              name="startTime"
              type="time"
              required
              defaultValue="08:30"
              className={controlClass}
            />
          </Field>
          <Field label="Returns">
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
          <Field label="Seats">
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
          <Field label="Dives">
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
          <Field label="Course" hint="(optional)">
            <select name="courseId" defaultValue="" className={controlClass}>
              <option value="">Ordinary trip</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Dive site" hint="(optional)">
            <select name="diveSiteId" defaultValue="" className={controlClass}>
              <option value="">Decide later</option>
              {diveSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.title}
                </option>
              ))}
            </select>
          </Field>
        </FieldGrid>
        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Adding…" className={buttonClass()}>
            Put it on the board
          </SubmitButton>
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </FieldGrid>
    );
  }

  return (
    <section aria-label="Schedule builder" className="mb-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">The board</h2>
          <p className="mt-1 text-sm text-muted">
            Add a departure, slide one to another day, copy it forward, or take it off. Open a trip
            for its dives, crew, and roster.
          </p>
        </div>
        {canConfigure ? (
          <button
            type="button"
            onClick={() => toggle("add:top")}
            aria-expanded={open === "add:top"}
            className={buttonClass({ className: "rounded-xl" })}
          >
            <span aria-hidden="true">+</span> Add a departure
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
                  aria-label={`Add a departure on ${day.label}`}
                  className={buttonClass({ variant: "ghost", size: "sm" })}
                >
                  <span aria-hidden="true">+</span> Add
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
                            trip.courseTitle ? `Course · ${trip.courseTitle}` : null,
                            trip.diveSiteName,
                            trip.dayCount > 1 ? `${trip.dayCount} days` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "No site set yet"}
                        </p>
                        <p className="mt-1 text-sm">
                          <span className="text-muted">Crew: </span>
                          {trip.crew.length > 0 ? (
                            trip.crew.join(", ")
                          ) : (
                            <span className="font-medium text-warning">nobody yet</span>
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
                            aria-label={`Move ${ref}`}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            Move
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(`copy:${trip.id}`)}
                            aria-expanded={open === `copy:${trip.id}`}
                            aria-label={`Copy ${ref}`}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            Copy
                          </button>
                          <form action={actions.remove}>
                            <input type="hidden" name="tripId" value={trip.id} />
                            <SubmitButton
                              pendingLabel="…"
                              ariaLabel={`Remove ${ref}`}
                              confirmMessage={`Take "${trip.title}" off the board for good?`}
                              className={buttonClass({ variant: "danger", size: "sm" })}
                            >
                              Remove
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
                          label="New date"
                          description={
                            trip.dayCount > 1
                              ? `All ${trip.dayCount} days move together, keeping their gaps.`
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
                        <Field label="New departure time">
                          <input
                            name="startTime"
                            type="time"
                            required
                            defaultValue={trip.startTime}
                            className={controlClass}
                          />
                        </Field>
                        <div className="flex items-center gap-3 sm:col-span-2">
                          <SubmitButton pendingLabel="Moving…" className={buttonClass()}>
                            Move it
                          </SubmitButton>
                          <button
                            type="button"
                            onClick={() => setOpen(null)}
                            className="text-sm font-medium text-muted hover:text-foreground"
                          >
                            Cancel
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
                        <Field
                          label="Copy to"
                          description="Same dive, same seats, same price — no divers and no crew."
                        >
                          <input
                            name="date"
                            type="date"
                            required
                            defaultValue={shiftIsoDay(trip.dateIso, 7)}
                            className={controlClass}
                          />
                        </Field>
                        <Field label="Departure time">
                          <input
                            name="startTime"
                            type="time"
                            required
                            defaultValue={trip.startTime}
                            className={controlClass}
                          />
                        </Field>
                        <div className="flex items-center gap-3 sm:col-span-2">
                          <SubmitButton pendingLabel="Copying…" className={buttonClass()}>
                            Copy it
                          </SubmitButton>
                          <button
                            type="button"
                            onClick={() => setOpen(null)}
                            className="text-sm font-medium text-muted hover:text-foreground"
                          >
                            Cancel
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
