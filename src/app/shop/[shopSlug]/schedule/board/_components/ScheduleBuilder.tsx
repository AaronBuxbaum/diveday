"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields, type TripDiveFieldsCopy } from "@/components/TripDiveFields";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { RepeatFields } from "./RepeatFields";

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

/**
 * What the add-a-departure panel's two selects offer. Fetched when the panel
 * opens (`loadOptions` below) rather than serialized into this component's
 * props on every board render: a shop's whole course catalogue and every dive
 * site it dives, shipped to a browser for two controls behind a closed panel.
 */
export type BuilderOptions = { courses: BuilderOption[]; diveSites: BuilderOption[] };

/**
 * Everything the price box needs that is neither copy nor a value — all of it
 * derived server-side from the shop's currency and the reader's locale, since
 * a Client Component may format neither.
 */
export type BuilderPriceInput = {
  /** `step`, from the currency's fraction digits: "1" for a zero-decimal one. */
  step: string;
  /** The largest figure the box accepts, in the shop's major units. */
  max: number;
  /** Zero, formatted for the shop's currency — the box's placeholder. */
  placeholder: string;
};

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
  price: string;
  priceDescription: string;
  course: string;
  optional: string;
  diveSite: string;
  ordinaryTrip: string;
  decideLater: string;
  optionsLoading: string;
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
  /* ---- the "More options" half of the one trip form (ADR 20260806-one-trip-create-form) ---- */
  viewOnlyNotice: string;
  moreOptions: string;
  fewerOptions: string;
  moreOptionsDescription: string;
  titlePlaceholderCourse: string;
  courseNote: string;
  courseCertRequired: string;
  courseNoCardRequired: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  daysLabel: string;
  daysDescription: string;
  payAtBookingLegend: string;
  payAtBookingDescription: string;
  depositLabel: string;
  depositDescription: string;
  depositTitle: string;
  cancellationWindowLabel: string;
  cancellationWindowDescription: string;
  hoursSuffix: string;
  repeatLegend: string;
  repeatDescription: string;
  howOftenLabel: string;
  doesntRepeat: string;
  everyWeek: string;
  every2Weeks: string;
  every4Weeks: string;
  numberOfTripsLabel: string;
  numberOfTripsDescription: string;
  numberOfTripsPlaceholder: string;
};

/**
 * A course the panel opens already pointed at, handed over by the staff course
 * catalogue's "schedule a session" control (`?course=<id>` on the board). Its
 * title is carried with the id because the select's options arrive on their own
 * fetch — without it the preselected course would render as a blank row until
 * the catalogue landed.
 */
export type BuilderInitialCourse = {
  id: string;
  title: string;
  /** The admission line the old full form showed under the select, pre-resolved. */
  requirement: string;
};

/** Everything the panel needs that only matters once "More options" is open. */
export type BuilderMoreOptions = {
  /** Occurrence bounds for the repeat fieldset (src/lib/recurrence.ts). */
  minOccurrences: number;
  maxOccurrences: number;
  /** Meeting-day bounds for a multi-day departure (src/lib/trip-days.ts). */
  minDays: number;
  maxDays: number;
  /** The per-dive cards' own words, shared with the trip editor. */
  diveFields: TripDiveFieldsCopy;
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
 * The one form that creates a departure, pre-dated to whichever day header it
 * was opened from.
 *
 * Two depths, one form. Collapsed it answers the question the board is for —
 * what is it, when, how many seats, what does it cost, whose course, which site
 * — and that is the path a shop takes all week. "More options" reveals the rest
 * of what a trip can be (a description, consecutive meeting days, a deposit and
 * a free-cancellation window, per-dive plans, a repeating cadence): the answers
 * a shop gives a few times a season, which until now lived on a second page at
 * `/trips/new` that staff had to know to leave for. Both depths post the same
 * fields to the same action; the quick ones simply aren't in the payload.
 * ADR 20260806-one-trip-create-form.
 *
 * Hoisted to module scope (rather than defined inside `ScheduleBuilder`)
 * so its identity is stable across renders — a component defined in a parent's
 * render body gets a new identity every render, which makes React unmount and
 * remount it (and its uncontrolled `<input>`s) on any parent re-render,
 * silently discarding whatever a staff member had typed.
 */
function AddPanel({
  dateIso,
  options,
  price,
  copy,
  more,
  initialCourse,
  startExpanded,
  onAdd,
  onCancel,
}: {
  dateIso: string;
  /** `null` until the panel's own fetch lands; the selects say so meanwhile. */
  options: BuilderOptions | null;
  price: BuilderPriceInput;
  copy: BuilderCopy;
  more: BuilderMoreOptions;
  initialCourse: BuilderInitialCourse | null;
  /** Opened straight into its full depth — a link that meant the whole form. */
  startExpanded: boolean;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  onAdd: (formData: FormData) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [expanded, setExpanded] = useState(startExpanded);
  // Controlled, unlike every other select here: the catalogue arrives on its own
  // fetch, so an uncontrolled preselection from `?course=` would be reconciled
  // away the moment the real options replaced the stand-in row below.
  const [courseId, setCourseId] = useState(initialCourse?.id ?? "");
  const onCourse = initialCourse !== null && courseId === initialCourse.id;

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
          placeholder={
            onCourse
              ? fill(copy.titlePlaceholderCourse, { courseTitle: initialCourse.title })
              : copy.titlePlaceholder
          }
          className={controlClass}
          ref={focusOnMount}
        />
      </Field>
      {expanded ? (
        <Field label={copy.descriptionLabel} hint={copy.optional}>
          <textarea
            name="description"
            rows={2}
            maxLength={500}
            placeholder={copy.descriptionPlaceholder}
            className={controlClass}
          />
        </Field>
      ) : null}
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
        {/* Expanded, the dive count moves into the dive-plan block below, where
            it is the thing that decides how many cards there are — two boxes
            named `plannedDives` on one form is the one shape this cannot take.
            A course weekend or a liveaboard takes its place: consecutive
            meeting days are one departure — one roster, one set of waivers,
            one crew — and nothing but this box can make one. */}
        {expanded ? (
          <Field label={copy.daysLabel} description={copy.daysDescription}>
            <input
              name="dayCount"
              type="number"
              required
              min={more.minDays}
              max={more.maxDays}
              defaultValue={more.minDays}
              className={`${controlClass} tabular-nums`}
            />
          </Field>
        ) : (
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
        )}
      </FieldGrid>
      {/* A departure minted here is on the public schedule the moment it is on
          the board, so this is where the price belongs — the board used to
          have no price box at all and then flag its own work with a "No price
          set" badge (task 150, UX persona lens 17). Still optional: the badge
          stays for the departure someone puts up before the season's rate is
          settled. The box is narrow, its helper line is not, so only the input
          is capped. */}
      <FieldGrid columns={1}>
        <Field label={copy.price} hint={copy.optional} description={copy.priceDescription}>
          <input
            name="priceDollars"
            type="number"
            step={price.step}
            min={0}
            max={price.max}
            placeholder={price.placeholder}
            className={`${controlClass} tabular-nums sm:w-40`}
          />
        </Field>
      </FieldGrid>
      {expanded ? (
        <fieldset className="rounded-lg border border-border bg-surface p-5">
          <legend className="px-1 text-sm font-medium">{copy.payAtBookingLegend}</legend>
          <p className="text-sm text-muted">{copy.payAtBookingDescription}</p>
          <FieldGrid columns={2} className="mt-4 gap-x-5 gap-y-5">
            <Field
              label={copy.depositLabel}
              hint={copy.optional}
              description={copy.depositDescription}
            >
              <input
                name="depositDollars"
                type="number"
                step={price.step}
                min={0}
                max={price.max}
                placeholder={price.placeholder}
                title={copy.depositTitle}
                className={`${controlClass} tabular-nums sm:w-40`}
              />
            </Field>
            <Field
              label={copy.cancellationWindowLabel}
              hint={copy.optional}
              description={copy.cancellationWindowDescription}
            >
              <div className="flex items-center gap-2">
                <input
                  name="cancellationWindowHours"
                  type="number"
                  step={1}
                  min={0}
                  max={720}
                  placeholder="48"
                  className={`${controlClass} tabular-nums sm:w-28`}
                />
                <span className="text-sm text-muted">{copy.hoursSuffix}</span>
              </div>
            </Field>
          </FieldGrid>
        </fieldset>
      ) : null}
      <FieldGrid columns={expanded ? 1 : 2} className="gap-y-4">
        <Field
          label={copy.course}
          hint={copy.optional}
          description={
            onCourse
              ? fill(copy.courseNote, {
                  requirement: initialCourse.requirement,
                })
              : undefined
          }
        >
          <select
            name="courseId"
            value={courseId}
            onChange={(event) => setCourseId(event.target.value)}
            className={controlClass}
          >
            <option value="">{copy.ordinaryTrip}</option>
            {options === null ? (
              <>
                {/* The catalogue is still in flight; the course this panel was
                    opened for is the one option that must already be here. */}
                {initialCourse ? (
                  <option value={initialCourse.id}>{initialCourse.title}</option>
                ) : null}
                <option value="" disabled>
                  {copy.optionsLoading}
                </option>
              </>
            ) : (
              options.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))
            )}
          </select>
        </Field>
        {/* One site for the day, or — expanded — a card per dive, each with its
            own site and briefing. The single select is the whole answer for a
            board built at speed; `dive-1-siteId` supersedes it the moment the
            cards exist. */}
        {expanded ? null : (
          <Field label={copy.diveSite} hint={copy.optional}>
            <select name="diveSiteId" defaultValue="" className={controlClass}>
              <option value="">{copy.decideLater}</option>
              {options === null ? (
                <option value="" disabled>
                  {copy.optionsLoading}
                </option>
              ) : (
                options.diveSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.title}
                  </option>
                ))
              )}
            </select>
          </Field>
        )}
      </FieldGrid>
      {expanded ? (
        <>
          <TripDiveFields
            diveSites={(options?.diveSites ?? []).map((site) => ({
              id: site.id,
              name: site.title,
            }))}
            copy={more.diveFields}
          />
          <fieldset className="rounded-lg border border-border bg-surface p-5">
            <legend className="px-1 text-sm font-medium">{copy.repeatLegend}</legend>
            <p className="text-sm text-muted">{copy.repeatDescription}</p>
            <RepeatFields
              minOccurrences={more.minOccurrences}
              maxOccurrences={more.maxOccurrences}
              copy={{
                howOftenLabel: copy.howOftenLabel,
                doesntRepeat: copy.doesntRepeat,
                everyWeek: copy.everyWeek,
                every2Weeks: copy.every2Weeks,
                every4Weeks: copy.every4Weeks,
                numberOfTripsLabel: copy.numberOfTripsLabel,
                numberOfTripsDescription: copy.numberOfTripsDescription,
                numberOfTripsPlaceholder: copy.numberOfTripsPlaceholder,
              }}
            />
          </fieldset>
        </>
      ) : null}
      {/* The rare half of the form, behind one control that says what is in it
          — collapsed by default because a shop puts a boat on the board far
          more often than it invents a new kind of departure (design
          principles #8). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {expanded ? copy.fewerOptions : copy.moreOptions}
        </button>
        {expanded ? null : (
          <span className="text-xs text-muted">{copy.moreOptionsDescription}</span>
        )}
      </div>
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
  loadOptions,
  price,
  actions,
  defaultDateIso,
  canConfigure,
  copy,
  more,
  initialCourse,
  openAdd,
}: {
  shopSlug: string;
  days: BuilderDay[];
  /** Fetches the add panel's course and dive-site options, first time it opens. */
  loadOptions: () => Promise<BuilderOptions>;
  price: BuilderPriceInput;
  actions: BuilderActions;
  /** The soonest day on the board, for the "Add a departure" button in the header. */
  defaultDateIso: string;
  canConfigure: boolean;
  copy: BuilderCopy;
  more: BuilderMoreOptions;
  /** Set when the board was reached from a course's "schedule a session" control. */
  initialCourse: BuilderInitialCourse | null;
  /**
   * Whether to arrive with the add panel already open, and how deep. Every
   * former door to `/trips/new` now lands here instead, and a link that used to
   * open a whole page of form has to open something.
   */
  openAdd: "closed" | "quick" | "expanded";
}) {
  // One of `add:<dateIso>`, `move:<tripId>`, `copy:<tripId>`, or null.
  const [open, setOpen] = useState<string | null>(openAdd === "closed" ? null : "add:top");
  const toggle = (panel: string) => setOpen((current) => (current === panel ? null : panel));

  // The add panel's selects, fetched the first time any add panel opens and
  // kept for the rest of the visit — the catalogue does not change while a
  // staff member schedules a week. A failed fetch clears the guard so the next
  // open tries again rather than leaving the selects saying "Loading…" forever.
  const [options, setOptions] = useState<BuilderOptions | null>(null);
  const optionsRequested = useRef(false);
  useEffect(() => {
    if (!open?.startsWith("add:") || optionsRequested.current) return;
    optionsRequested.current = true;
    loadOptions().then(setOptions, () => {
      optionsRequested.current = false;
    });
  }, [open, loadOptions]);

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
  // Skipping the genuine first mount is load-bearing: effects run only after
  // hydration *completes*, but selective hydration lets a person open a panel
  // the moment its own button is interactive — so on a slow connection this
  // effect's initial run landed after their click and snapped the panel shut
  // (caught as a detached-mid-click flake in e2e/schedule-builder.spec.ts on
  // CI). A ref, not state: refs survive an Activity-preserved hide/re-show
  // while its effects re-run, so the re-show still resets — only the true
  // first mount is exempt. The race itself can't be scripted deterministically
  // (nothing schedules a click between commit and passive effects), which is
  // why no regression test accompanies this.
  const pathnameEffectRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change closes the panel, which is the point.
  useEffect(() => {
    if (!pathnameEffectRan.current) {
      pathnameEffectRan.current = true;
      return;
    }
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
            // Primary while it is the section's one obvious action; secondary
            // the moment it has done its job, because the panel it opened ends
            // in "Put it on the board" and a section may only have one primary
            // (design principles #8). Open, this button is the panel's handle,
            // not the thing to press next.
            className={buttonClass({
              variant: open === "add:top" ? "secondary" : undefined,
              className: "rounded-xl",
            })}
          >
            <span aria-hidden="true">+</span> {copy.addDeparture}
          </button>
        ) : null}
      </div>

      {/* Creating a departure is owner/manager/instructor work (H-14). The
          crew still reads the board — they run the day off it — so rather than
          silently omitting every add control, it says whose job this is. The
          sentence moved here from `/trips/new`, which used to be where a
          captain found out. */}
      {canConfigure ? null : (
        <p className="mb-3 rounded-xl border border-border bg-surface-sunken/50 p-4 text-sm text-muted">
          {copy.viewOnlyNotice}
        </p>
      )}

      {/* Keyed "add:top" rather than by its date: the header button and the
          first day's own "+ Add" would otherwise share a panel key and render
          two identical forms at once. */}
      {canConfigure && open === "add:top" ? (
        <AddPanel
          dateIso={defaultDateIso}
          options={options}
          price={price}
          copy={copy}
          more={more}
          initialCourse={initialCourse}
          startExpanded={openAdd === "expanded"}
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
                options={options}
                price={price}
                copy={copy}
                more={more}
                initialCourse={null}
                startExpanded={false}
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
                    {/* Two columns, not six loose flex children. The time, the
                        title block, the badges and the buttons all used to sit
                        side by side under `items-start`, so a short badge and
                        an 11-unit-tall button row hung off the top of a
                        three-line title at three different heights and nothing
                        lined up with anything. Now: what the departure *is* on
                        the left, what you *do* about it on the right, each
                        internally aligned. */}
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                      <div className="flex w-full min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1 sm:w-auto sm:flex-1">
                        {/* `leading-6` matches the title's line box, so the
                            time and the departure name share a baseline
                            instead of sitting two pixels apart.
                            `whitespace-nowrap`: a formatted range puts an
                            ordinary space before AM/PM, so a column too narrow
                            for it breaks there and strands "PM" on its own line
                            ("6:30 PM – 10:00" / "PM"). The column is wide enough
                            for the longest range at this type size; on a phone it
                            takes the full row instead of squeezing the title into
                            a three-line stack. */}
                        <div className="w-full shrink-0 text-sm leading-6 tabular-nums whitespace-nowrap text-muted sm:w-36">
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
                      </div>
                      {/* The right-hand column: what this departure's state is,
                          then what you can do about it, on one centred line. */}
                      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
                            {/* Remove opens a panel like Move and Copy do,
                                rather than swapping itself for an
                                `InlineConfirm` message card in place. That card
                                is built to be a block of its own, and inside
                                this inline button cluster it inflated into a
                                bordered box wedged between the badges and the
                                row's edge — every other row on the board
                                shifted around it while the staffer read the
                                sentence. It is still two deliberate steps: this
                                trigger submits nothing, and the panel below
                                holds the only real submit. */}
                            <button
                              type="button"
                              ref={registerToggle(`remove:${trip.id}`)}
                              onClick={() => toggle(`remove:${trip.id}`)}
                              aria-expanded={open === `remove:${trip.id}`}
                              aria-label={fill(copy.removeAria, { ref })}
                              className={buttonClass({ variant: "danger", size: "sm" })}
                            >
                              {copy.remove}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {canConfigure && open === `remove:${trip.id}` ? (
                      <form
                        action={actions.remove}
                        className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-4 animate-scale-in"
                      >
                        <input type="hidden" name="tripId" value={trip.id} />
                        <p className="text-sm" role="alert">
                          {fill(copy.removeConfirm, { title: trip.title })}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <SubmitButton
                            pendingLabel={copy.removePending}
                            className={buttonClass({ variant: "danger", size: "sm" })}
                          >
                            {copy.removeConfirmButton}
                          </SubmitButton>
                          <button
                            type="button"
                            onClick={() => closePanel(`remove:${trip.id}`)}
                            className={buttonClass({ variant: "ghost", size: "sm" })}
                          >
                            {copy.removeCancel}
                          </button>
                        </div>
                      </form>
                    ) : null}

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
