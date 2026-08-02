"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";

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
  /**
   * Null when no price has ever been set. A builder-created trip publishes
   * to the public schedule the moment it's on the board, price or not, and
   * the builder never said so (task 150, UX persona lens 17) — flagged here
   * so staff catch it before a diver hits an unpriced trip on the public
   * page.
   */
  priceCents: number | null;
  /**
   * Set only on a departure that is already back at the dock with an after-dive
   * head count still open (DOM-H3) — the number that says whether everybody
   * came out of the water. Those rows are the one thing on this board that
   * looks backwards: a returned trip is otherwise never listed here, and it is
   * carried in for exactly as long as the count stays open. `diveNumber` is
   * the earliest dive still unclosed, `uncounted` how many divers on that
   * boat's list have no result recorded at it.
   */
  rollCallOpen: { diveNumber: number; uncounted: number } | null;
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
  noPriceSet: string;
  noPriceSetAria: string;
  rollCallOpen: string;
  rollCallOpenAria: string;
  rollCallOpenNote: string;
  move: string;
  moveAria: string;
  copy: string;
  copyAria: string;
  remove: string;
  removeAria: string;
  removeConfirm: string;
  removeConfirmButton: string;
  removeCancel: string;
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
 * Moves focus into a panel's first field the moment it mounts. Every panel
 * here is conditionally rendered (not just hidden), so this ref callback
 * fires exactly once per open — biome's `noAutofocus` blocks the JSX
 * `autoFocus` attribute outright (it can't tell a page-load autofocus from
 * this one, which only ever runs in direct response to the staff member's
 * own click on the toggle that revealed the panel).
 */
function focusOnMount(el: HTMLElement | null) {
  el?.focus();
}

/**
 * The "add a departure" form, pre-dated to whichever day header it was opened
 * from. Hoisted to module scope (rather than defined inside `ScheduleBuilder`)
 * so its identity is stable across renders — a component defined in a parent's
 * render body gets a new identity every render, which makes React unmount and
 * remount it (and its uncontrolled `<input>`s) on any parent re-render,
 * silently discarding whatever a staff member had typed.
 */
function AddPanel({
  dateIso,
  courses,
  diveSites,
  copy,
  onAdd,
  onCancel,
}: {
  dateIso: string;
  courses: BuilderOption[];
  diveSites: BuilderOption[];
  copy: BuilderCopy;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  onAdd: (formData: FormData) => void | Promise<void>;
  onCancel: () => void;
}) {
  return (
    <FieldGrid
      as="form"
      action={onAdd}
      columns={1}
      className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
    >
      <Field label={copy.whatIsIt}>
        <input
          name="title"
          type="text"
          required
          maxLength={120}
          placeholder={copy.titlePlaceholder}
          className={controlClass}
          ref={focusOnMount}
        />
      </Field>
      <FieldGrid columns={3} className="gap-y-4">
        <Field label={copy.date}>
          <input name="date" type="date" required defaultValue={dateIso} className={controlClass} />
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
          onClick={onCancel}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {copy.cancel}
        </button>
      </div>
    </FieldGrid>
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

  // Every toggle button that can open a panel, keyed the same way `open` is,
  // so Cancel can hand keyboard focus back to the exact control that opened
  // it instead of leaving it on `<body>` when the panel unmounts.
  const toggleRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const registerToggle = (key: string) => (el: HTMLButtonElement | null) => {
    toggleRefs.current[key] = el;
  };
  const closePanel = (key: string) => {
    setOpen(null);
    toggleRefs.current[key]?.focus();
  };

  // The schedule route has no dynamic id, so if `cacheComponents: true`'s
  // Activity-based navigation is ever re-enabled, this instance could
  // otherwise be preserved across a navigate-away-and-back with a panel left
  // expanded and its defaults stale (docs ADR
  // 20260801-cache-components-activity-state, currently reverted, commit
  // 100fcf8). Reset on the leading edge of any (re)navigation, same pattern
  // as InlineConfirm.
  const pathname = usePathname();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change closes the panel, which is the point.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);

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
            ref={registerToggle("add:top")}
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
      {canConfigure && open === "add:top" ? (
        <AddPanel
          dateIso={defaultDateIso}
          courses={courses}
          diveSites={diveSites}
          copy={copy}
          onAdd={actions.add}
          onCancel={() => closePanel("add:top")}
        />
      ) : null}

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
                  ref={registerToggle(`add:${day.dateIso}`)}
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
              <AddPanel
                dateIso={day.dateIso}
                courses={courses}
                diveSites={diveSites}
                copy={copy}
                onAdd={actions.add}
                onCancel={() => closePanel(`add:${day.dateIso}`)}
              />
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
                      {/* `whitespace-nowrap`: a formatted range puts an
                          ordinary space before AM/PM, so a column too narrow
                          for it breaks there and strands "PM" on its own line
                          ("6:30 PM – 10:00" / "PM"). The column is wide enough
                          for the longest range at this type size; on a phone it
                          takes the full row instead of squeezing the title into
                          a three-line stack. */}
                      <div className="w-full shrink-0 text-sm tabular-nums whitespace-nowrap text-muted sm:w-36">
                        {trip.timeRange}
                      </div>
                      {/* Full width on a phone so the title gets the row to
                          itself and the badges wrap below it, rather than
                          sharing ~340px with them and stacking three lines
                          deep. */}
                      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
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
                        {/* A returned departure is otherwise the only row here
                            that isn't upcoming, so it says why it is still on
                            the board rather than looking like a stale entry. */}
                        {trip.rollCallOpen ? (
                          <p className="mt-1 text-sm font-medium text-danger">
                            {fill(copy.rollCallOpenNote, {
                              dive: trip.rollCallOpen.diveNumber,
                            })}
                          </p>
                        ) : null}
                      </div>
                      {/* A sold-out boat is a win worth noticing, not a quiet
                          state (design/principles.md #3) — "success" stands
                          out where "neutral" would recede. Matches the same
                          badge on the trip page (task appendix, UX persona
                          lens 17: this one used to render grey here and green
                          there for the same fact). */}
                      <Badge tone={full ? "success" : "primary"} tabularNums>
                        {trip.booked}/{trip.capacity}
                      </Badge>
                      {/* The loudest thing this board can say (DOM-H3): the
                          boat is back and somebody on its list was never
                          counted. "danger" carries an aria-hidden ✕ of its
                          own, so hue is never the only signal, and the whole
                          badge is a link straight to the open checkpoint. */}
                      {trip.rollCallOpen ? (
                        <Link
                          href={`/shop/${shopSlug}/trips/${trip.id}/manifest?checkpoint=after_dive_${trip.rollCallOpen.diveNumber}`}
                          aria-label={fill(copy.rollCallOpenAria, {
                            ref,
                            dive: trip.rollCallOpen.diveNumber,
                          })}
                        >
                          <Badge tone="danger">
                            {fill(copy.rollCallOpen, { count: trip.rollCallOpen.uncounted })}
                          </Badge>
                        </Link>
                      ) : null}
                      {trip.priceCents === null ? (
                        <Link
                          href={`/shop/${shopSlug}/trips/${trip.id}#details`}
                          aria-label={fill(copy.noPriceSetAria, { ref })}
                        >
                          <Badge tone="warning">{copy.noPriceSet}</Badge>
                        </Link>
                      ) : null}
                      {/* Move/copy/remove are all refused by `src/db/trips.ts`
                          for a departure that has already sailed, and a
                          returned row is only here to have its head count
                          closed — so it gets the badge and nothing that would
                          bounce. */}
                      {canConfigure && !trip.rollCallOpen ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-1">
                          <button
                            type="button"
                            ref={registerToggle(`move:${trip.id}`)}
                            onClick={() => toggle(`move:${trip.id}`)}
                            aria-expanded={open === `move:${trip.id}`}
                            aria-label={fill(copy.moveAria, { ref })}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {copy.move}
                          </button>
                          <button
                            type="button"
                            ref={registerToggle(`copy:${trip.id}`)}
                            onClick={() => toggle(`copy:${trip.id}`)}
                            aria-expanded={open === `copy:${trip.id}`}
                            aria-label={fill(copy.copyAria, { ref })}
                            className={buttonClass({ variant: "secondary", size: "sm" })}
                          >
                            {copy.copy}
                          </button>
                          <form action={actions.remove}>
                            <input type="hidden" name="tripId" value={trip.id} />
                            <InlineConfirm
                              triggerLabel={copy.remove}
                              triggerClassName={buttonClass({ variant: "danger", size: "sm" })}
                              message={fill(copy.removeConfirm, { title: trip.title })}
                              confirmLabel={copy.removeConfirmButton}
                              cancelLabel={copy.removeCancel}
                              pendingLabel={copy.removePending}
                              ariaLabel={fill(copy.removeAria, { ref })}
                            />
                          </form>
                        </div>
                      ) : null}
                    </div>

                    {canConfigure && open === `move:${trip.id}` ? (
                      <FieldGrid
                        as="form"
                        action={actions.move}
                        columns={2}
                        className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
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
                            ref={focusOnMount}
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
                            onClick={() => closePanel(`move:${trip.id}`)}
                            className={buttonClass({ variant: "ghost", size: "sm" })}
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
                        className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
                      >
                        <input type="hidden" name="tripId" value={trip.id} />
                        <Field label={copy.copyTo} description={copy.copyDescription}>
                          <input
                            name="date"
                            type="date"
                            required
                            defaultValue={shiftIsoDay(trip.dateIso, 7)}
                            className={controlClass}
                            ref={focusOnMount}
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
                            onClick={() => closePanel(`copy:${trip.id}`)}
                            className={buttonClass({ variant: "ghost", size: "sm" })}
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
