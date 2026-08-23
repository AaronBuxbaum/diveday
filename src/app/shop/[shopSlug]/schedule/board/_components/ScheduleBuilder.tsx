"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RepeatFields } from "@/components/RepeatFields";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields, type TripDiveFieldsCopy } from "@/components/TripDiveFields";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import { shiftCalendarDate } from "@/lib/calendar-date";
import {
  MAX_DECISION_HOURS,
  MAX_MINIMUM_BOOKINGS,
  MIN_DECISION_HOURS,
  MINIMUM_SEATS_DECISION_HOURS_DEFAULT,
} from "@/lib/minimum-seats";

/** One departure as the board hands it to the builder, already shop-local. */
export type BuilderTrip = {
  id: string;
  title: string;
  /**
   * The assigned hull's id, for the board's per-boat double-booking check
   * (`overlappingBoatIds`). `boatName` below is what a card renders; this is
   * what identifies the vessel, since two hulls may share a name.
   */
  boatId?: string | null;
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
  diveMode?: "boat" | "shore" | "pool";
  boatName?: string | null;
  startsAt?: Date;
  endsAt?: Date;
};

export type BuilderDay = {
  dateIso: string;
  /** Preformatted for the shop's locale, e.g. "Tue, Jul 21". */
  label: string;
  /**
   * The same date as a calendar block — big day numeral, weekday and month
   * caps — so the board's day headers read exactly like the public schedule's
   * (`formatDayParts`). One calendar grammar on both sides of the counter:
   * the staff board and the diver schedule are the same schedule, and they
   * should look like it.
   */
  parts: { weekday: string; day: string; month: string };
  trips: BuilderTrip[];
  boatWarning?: string | null;
};

export type BuilderOption = { id: string; title: string };
export type BuilderCourseOption = BuilderOption & { agency: string };
export type BuilderBoatOption = { id: string; name: string; capacity: number };

/**
 * What the add-a-departure panel's two selects offer. Fetched when the panel
 * opens (`loadOptions` below) rather than serialized into this component's
 * props on every board render: a shop's whole course catalogue and every dive
 * site it dives, shipped to a browser for two controls behind a closed panel.
 */
/** The three kinds of departure a shop can run, in the order the select offers them. */
export type DiveMode = "boat" | "shore" | "pool";

export type BuilderOptions = {
  courses: BuilderCourseOption[];
  diveSites: BuilderOption[];
  boats?: BuilderBoatOption[];
  hasBoatDiving?: boolean;
  hasShoreDiving?: boolean;
  hasPoolDiving?: boolean;
};

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
  ariaLabel: string;
  addDepartureOnDay: string;
  add: string;
  cancel: string;
  noSiteSetYet: string;
  courseLabel: string;
  dayCountLabelOne: string;
  dayCountLabelOther: string;
  crewLabel: string;
  crewNobodyYet: string;
  crewMostlyAll: string;
  noPriceSet: string;
  noPriceSetAria: string;
  noPriceSetAll: string;
  rollCallOpen: string;
  rollCallOpenAria: string;
  rollCallOpenNote: string;
  rowActionsAria: string;
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
  courseAgencyLabels: { padi: string; ssi: string; other: string };
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
  isPrivateLabel: string;
  isPrivateHint: string;
  daysLabel: string;
  daysDescription: string;
  payAtBookingLegend: string;
  payAtBookingDescription: string;
  depositLabel: string;
  depositDescription: string;
  depositTitle: string;
  cancellationWindowLabel: string;
  cancellationWindowDescription: string;
  minimumBookingsLabel: string;
  minimumBookingsDescription: string;
  minimumDecisionLabel: string;
  minimumDecisionDescription: string;
  diversSuffix: string;
  hoursBeforeSuffix: string;
  hoursSuffix: string;
  repeatLegend: string;
  repeatDescription: string;
  howOftenLabel: string;
  doesntRepeat: string;
  everyWeek: string;
  every2Weeks: string;
  every4Weeks: string;
  repeatsOnLabel: string;
  everyDay: string;
  endsLabel: string;
  endsNever: string;
  endsOnChoice: string;
  endsOnLabel: string;
  requestPlanHeading?: string;
  requestPlanDescription?: string;
  requestPlanRecommendation?: string;
  requestPlanRecommendationDiversOne?: string;
  requestPlanRecommendationDiversOther?: string;
  requestPlanRecommendationCapacityOne?: string;
  requestPlanRecommendationCapacityOther?: string;
  requestPlanDiversOne?: string;
  requestPlanDiversOther?: string;
  requestPlanPersonOne?: string;
  requestPlanPersonOther?: string;
  requestPlanBoatRecommendationOne?: string;
  requestPlanBoatRecommendationOther?: string;
  requestPlanBoatExceeded?: string;
  requestPlanCrewSuggestionOne?: string;
  requestPlanCrewSuggestionOther?: string;
  diveModeLabel?: string;
  modeBoat?: string;
  modeShore?: string;
  modePool?: string;
  boatSelectLabel?: string;
  unassignedBoat?: string;
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

export type BuilderInitialSite = {
  id: string;
  name: string;
};

/**
 * Lead context handed from Requests to the one trip-creation form. Checked
 * rows become invitations only; they do not become bookings or consume seats.
 */
export type BuilderRequestPlan = {
  estimatedDivers: number;
  suggestedCapacity: number;
  /** Divemasters these leads want at the shop's target, and the target itself. */
  suggestedDivemasters: number;
  diversPerDivemaster: number;
  suggestedBoatName?: string | null;
  exceedsKnownBoats?: boolean;
  requests: Array<{
    id: string;
    name: string;
    subject: string;
    divers: number;
  }>;
};

/** Everything the panel needs that only matters once "More options" is open. */
export type BuilderMoreOptions = {
  /**
   * The seven weekday names, Sunday first, spelled for the request locale — the
   * repeat fieldset's day picker. Calendar data, so `Intl` provides them rather
   * than the message bundle; they are resolved on the server because that is
   * where the negotiated locale lives.
   */
  weekdayNames: string[];
  /** Meeting-day bounds for a multi-day departure (src/lib/trip-days.ts). */
  minDays: number;
  maxDays: number;
  /** The per-dive cards' own words, shared with the trip editor. */
  diveFields: TripDiveFieldsCopy;
};

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
 * was opened from. Two depths, one form, one action: "More options" discloses
 * the rest of what a trip can be (ADR 20260806-one-trip-create-form).
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
  initialSite,
  requestPlan,
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
  initialSite?: BuilderInitialSite | null;
  requestPlan?: BuilderRequestPlan | null;
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

  // **What this shop actually runs, in the order the select offers it.** Boat
  // is no longer assumed: a shore-and-pool operation must not be able to put a
  // departure on a hull it has told us it does not have, and its form should
  // open on the mode it does run rather than on one it has to change away from
  // every time. `options` is undefined until the board's lazy fetch lands, and
  // boat-only is the right stand-in for that beat because it is the default a
  // fresh shop carries.
  const offeredModes: DiveMode[] = useMemo(
    () =>
      options
        ? ([
            options.hasBoatDiving ? "boat" : null,
            options.hasShoreDiving ? "shore" : null,
            options.hasPoolDiving ? "pool" : null,
          ].filter(Boolean) as DiveMode[])
        : ["boat"],
    [options],
  );
  const defaultMode: DiveMode = offeredModes[0] ?? "boat";
  const [diveMode, setDiveMode] = useState<DiveMode>(defaultMode);
  // The options arrive after first paint, so a shop whose first offered mode is
  // not `boat` would otherwise sit on a stale default until somebody touched
  // the select — and submit `boat` if they never did.
  useEffect(() => {
    setDiveMode((current) => (offeredModes.includes(current) ? current : defaultMode));
  }, [offeredModes, defaultMode]);
  const [selectedBoatId, setSelectedBoatId] = useState<string>("");
  const [capacity, setCapacity] = useState<number>(requestPlan?.suggestedCapacity ?? 12);

  /**
   * The two facts both depths ask for, held here so the disclosure can never
   * eat them: collapsed they are the "Dives" box and the "Dive site" select,
   * expanded they are the dive plan's own count and dive one's site. State in
   * the panel, not in either control, is what lets a staff member type 3 dives,
   * open More options, and still be scheduling three dives.
   */
  const [plannedDives, setPlannedDives] = useState(2);
  const [diveSiteId, setDiveSiteId] = useState(initialSite?.id ?? "");
  /**
   * The dive plan is mounted from the first expansion onward and only hidden
   * afterwards — never unmounted, because React drops an unmounted subtree's
   * state and those are typed dive briefings. Seeded once, from whatever the
   * quick row held at that moment; later toggles must not re-seed it or they
   * would overwrite the cards with the quick row again.
   */
  const [diveSeed, setDiveSeed] = useState<{ count: number; siteId: string } | null>(
    startExpanded || initialSite ? { count: 2, siteId: initialSite?.id ?? "" } : null,
  );
  const toggleExpanded = () => {
    setExpanded((current) => {
      if (!current && diveSeed === null) setDiveSeed({ count: plannedDives, siteId: diveSiteId });
      return !current;
    });
  };
  /** The departure's date, mirrored so the repeat fieldset can seed its weekday. */
  const [startDate, setStartDate] = useState(dateIso);

  return (
    <FieldGrid
      as="form"
      action={onAdd}
      columns={1}
      className="mt-3 rounded-xl border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
    >
      {requestPlan ? (
        <fieldset className="sticky top-4 z-10 rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm">
          <legend className="px-1 text-sm font-semibold text-primary">
            {copy.requestPlanHeading ?? ""}
          </legend>
          <p className="text-sm text-muted">{copy.requestPlanDescription ?? ""}</p>
          <p className="mt-2 text-sm font-medium">
            {/* Two independent counts in one line, so two pairs and a template
                that holds only their order — a single `{n} divers … {n} seats`
                string cannot inflect both, and at one of each it read "About 1
                divers are represented. Suggested starting capacity: 1 seats."
                (issue #778). */}
            {fill(copy.requestPlanRecommendation ?? "", {
              diversPart: fill(
                pluralForm(requestPlan.estimatedDivers, {
                  one: copy.requestPlanRecommendationDiversOne ?? "",
                  other: copy.requestPlanRecommendationDiversOther ?? "",
                }),
                { divers: requestPlan.estimatedDivers },
              ),
              capacityPart: fill(
                pluralForm(requestPlan.suggestedCapacity, {
                  one: copy.requestPlanRecommendationCapacityOne ?? "",
                  other: copy.requestPlanRecommendationCapacityOther ?? "",
                }),
                { capacity: requestPlan.suggestedCapacity },
              ),
            })}
          </p>
          {requestPlan.suggestedBoatName ? (
            <p className="mt-1 text-sm text-muted font-medium">
              {fill(
                pluralForm(requestPlan.suggestedCapacity, {
                  one: copy.requestPlanBoatRecommendationOne ?? "",
                  other: copy.requestPlanBoatRecommendationOther ?? "",
                }),
                {
                  boatName: requestPlan.suggestedBoatName,
                  capacity: requestPlan.suggestedCapacity,
                },
              )}
            </p>
          ) : null}
          {requestPlan.exceedsKnownBoats ? (
            <p className="mt-1 text-sm text-warning font-medium">
              {copy.requestPlanBoatExceeded ?? ""}
            </p>
          ) : null}
          {requestPlan.suggestedDivemasters > 0 ? (
            <p className="mt-1 text-sm text-muted font-medium">
              {fill(
                pluralForm(requestPlan.suggestedDivemasters, {
                  one: copy.requestPlanCrewSuggestionOne ?? "",
                  other: copy.requestPlanCrewSuggestionOther ?? "",
                }),
                {
                  divemasters: requestPlan.suggestedDivemasters,
                  ratio: requestPlan.diversPerDivemaster,
                },
              )}
            </p>
          ) : null}
          <ul className="mt-3 grid gap-2">
            {requestPlan.requests.map((request) => (
              <li key={request.id}>
                <label className="flex min-h-11 items-start gap-3 rounded-lg bg-surface px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    name="inquiryId"
                    value={request.id}
                    defaultChecked
                    className="mt-1 size-4 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {fill(
                        pluralForm(request.divers, {
                          one: copy.requestPlanPersonOne ?? "",
                          other: copy.requestPlanPersonOther ?? "",
                        }),
                        { name: request.name, divers: request.divers },
                      )}
                    </span>
                    <span className="block text-muted">{request.subject}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}
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
      {/* Every expanded-only block below is `hidden`, never unmounted, and
          `disabled` while hidden — React drops an unmounted subtree's state,
          and a disabled control submits nothing, so the collapsed payload is
          exactly the quick one. Expanding and collapsing is a change of view,
          never a loss of work. */}
      <Field
        label={copy.descriptionLabel}
        hint={copy.optional}
        // `hidden` on the field itself, never a wrapper `<div>`: `FieldGrid`
        // aligns a row's captions and controls by making each `Field` a direct
        // grid item, and a wrapper steals that place and drops the row out of
        // alignment (docs/design/forms-and-controls.md).
        className={expanded ? undefined : "hidden"}
      >
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          disabled={!expanded}
          placeholder={copy.descriptionPlaceholder}
          className={controlClass}
        />
      </Field>
      <Field label={null} className={expanded ? undefined : "hidden"}>
        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer py-2">
          <input
            type="checkbox"
            name="isPrivate"
            value="true"
            disabled={!expanded}
            className="size-4 rounded border-border"
          />
          <div className="flex flex-col">
            <span>{copy.isPrivateLabel}</span>
            <span className="text-xs font-normal text-muted">{copy.isPrivateHint}</span>
          </div>
        </label>
      </Field>
      <FieldGrid columns={3} className="gap-y-4">
        <Field label={copy.date}>
          {/* Read here as well as submitted: the repeat fieldset below pre-checks
              this date's own weekday, so it has to see the date change. */}
          <input
            name="date"
            type="date"
            required
            defaultValue={dateIso}
            onChange={(event) => setStartDate(event.currentTarget.value)}
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
      {/* Under the date row, where the rest of "when" already lives — not in
          the Seats/Dives cell. Expanding must only ever *add* a field below;
          a cell whose label changes out from under the cursor reads as the
          form rewriting itself. */}
      <Field
        label={copy.daysLabel}
        description={copy.daysDescription}
        className={expanded ? undefined : "hidden"}
      >
        <input
          name="dayCount"
          type="number"
          required={expanded}
          disabled={!expanded}
          min={more.minDays}
          max={more.maxDays}
          defaultValue={more.minDays}
          className={`${controlClass} tabular-nums sm:w-40`}
        />
      </Field>
      {offeredModes.length > 1 || (options?.boats && options.boats.length > 0) ? (
        <FieldGrid columns={2} className="gap-y-4">
          {offeredModes.length > 1 ? (
            <Field label={copy.diveModeLabel ?? "Dive mode"}>
              <select
                name="diveMode"
                value={diveMode}
                onChange={(event) => setDiveMode(event.target.value as DiveMode)}
                className={controlClass}
              >
                {offeredModes.includes("boat") ? (
                  <option value="boat">{copy.modeBoat ?? "Boat dive"}</option>
                ) : null}
                {offeredModes.includes("shore") ? (
                  <option value="shore">{copy.modeShore ?? "Shore dive"}</option>
                ) : null}
                {offeredModes.includes("pool") ? (
                  <option value="pool">{copy.modePool ?? "Pool session"}</option>
                ) : null}
              </select>
            </Field>
          ) : (
            // One mode on offer is not a choice — it is submitted, not asked.
            <input type="hidden" name="diveMode" value={offeredModes[0] ?? "boat"} />
          )}
          {diveMode === "boat" && options?.boats && options.boats.length > 0 ? (
            <Field label={copy.boatSelectLabel ?? "Assigned boat"} hint={copy.optional}>
              <select
                name="boatId"
                value={selectedBoatId}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedBoatId(id);
                  const boat = options?.boats?.find((b) => b.id === id);
                  if (boat) setCapacity(boat.capacity);
                }}
                className={controlClass}
              >
                <option value="">{copy.unassignedBoat ?? "Any / unassigned"}</option>
                {options.boats.map((boat) => (
                  <option key={boat.id} value={boat.id}>
                    {boat.name} ({boat.capacity} seats)
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </FieldGrid>
      ) : (
        <input type="hidden" name="diveMode" value={offeredModes[0] ?? "boat"} />
      )}
      <FieldGrid columns={2} className="gap-y-4">
        <Field label={copy.seats}>
          <input
            name="capacity"
            type="number"
            required
            min={1}
            max={60}
            value={capacity}
            onChange={(event) => setCapacity(Number(event.target.value))}
            className={`${controlClass} tabular-nums`}
          />
        </Field>
        {/* Handed off, not duplicated: expanded, the count is the dive plan's
            own select. Two enabled boxes named `plannedDives` would let
            whichever is last in the DOM win silently, so this one goes
            disabled — and the panel holds the value either way. */}
        <Field label={copy.dives} className={expanded ? "hidden" : undefined}>
          <input
            name="plannedDives"
            type="number"
            required={!expanded}
            disabled={expanded}
            min={1}
            max={4}
            value={plannedDives}
            onChange={(event) => setPlannedDives(Number(event.target.value))}
            className={`${controlClass} tabular-nums`}
          />
        </Field>
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
      {/* `<fieldset disabled>` reaches every control inside it, so this whole
          block leaves the submission in one attribute while it is hidden. */}
      {/* A legend names this payment control group; it must remain a
          fieldset rather than becoming a generic SectionCard. */}
      <fieldset
        hidden={!expanded}
        disabled={!expanded}
        className="rounded-lg border border-border bg-surface p-5"
      >
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
          <Field
            label={copy.minimumBookingsLabel}
            hint={copy.optional}
            description={copy.minimumBookingsDescription}
          >
            <div className="flex items-center gap-2">
              <input
                name="minimumBookings"
                type="number"
                step={1}
                min={1}
                max={MAX_MINIMUM_BOOKINGS}
                placeholder="4"
                className={`${controlClass} tabular-nums sm:w-28`}
              />
              <span className="text-sm text-muted">{copy.diversSuffix}</span>
            </div>
          </Field>
          <Field
            label={copy.minimumDecisionLabel}
            hint={copy.optional}
            description={copy.minimumDecisionDescription}
          >
            <div className="flex items-center gap-2">
              <input
                name="minimumDecisionHours"
                type="number"
                step={1}
                min={MIN_DECISION_HOURS}
                max={MAX_DECISION_HOURS}
                placeholder={String(MINIMUM_SEATS_DECISION_HOURS_DEFAULT)}
                className={`${controlClass} tabular-nums sm:w-28`}
              />
              <span className="text-sm text-muted">{copy.hoursBeforeSuffix}</span>
            </div>
          </Field>
        </FieldGrid>
      </fieldset>
      {/* Two columns in both states: `columns={expanded ? 1 : 2}` made the
          Course select jump from half-width to full on every toggle. */}
      <FieldGrid columns={2} className="gap-y-4">
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
              Object.entries(
                options.courses.reduce<Record<string, BuilderCourseOption[]>>((groups, course) => {
                  const key = course.agency.trim().toLowerCase() || "other";
                  const group = groups[key] ?? [];
                  group.push(course);
                  groups[key] = group;
                  return groups;
                }, {}),
              ).map(([agency, courses]) => (
                <optgroup
                  key={agency}
                  label={
                    copy.courseAgencyLabels[agency as keyof typeof copy.courseAgencyLabels] ??
                    (agency === "other" ? copy.courseAgencyLabels.other : agency.toUpperCase())
                  }
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.title}
                    </option>
                  ))}
                </optgroup>
              ))
            )}
          </select>
        </Field>
        {/* One site for the day, or — expanded — `dive-N-siteId` per dive.
            Never both: dive one's select is seeded from this one on the first
            expansion and writes back to it, so the two never disagree. */}
        <Field
          label={copy.diveSite}
          hint={copy.optional}
          className={expanded ? "hidden" : undefined}
        >
          <select
            name="diveSiteId"
            value={diveSiteId}
            disabled={expanded}
            onChange={(event) => setDiveSiteId(event.target.value)}
            className={controlClass}
          >
            <option value="">{copy.decideLater}</option>
            {initialSite && options === null ? (
              <option value={initialSite.id}>{initialSite.name}</option>
            ) : null}
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
      </FieldGrid>
      {diveSeed === null ? null : (
        <TripDiveFields
          diveSites={(options?.diveSites ?? []).map((site) => ({
            id: site.id,
            name: site.title,
          }))}
          initialCount={diveSeed.count}
          initialDives={[
            {
              title: null,
              diveSiteId: diveSeed.siteId || null,
              description: null,
              // A brand-new departure states no legs, so every one of them
              // reads the shop's own ride out until somebody types otherwise.
              travelMinutes: null,
            },
          ]}
          disabled={!expanded}
          onCountChange={setPlannedDives}
          onFirstDiveSiteChange={setDiveSiteId}
          copy={more.diveFields}
        />
      )}
      {/* A legend names this recurrence control group; it must remain a
          fieldset rather than becoming a generic SectionCard. */}
      <fieldset
        hidden={!expanded}
        disabled={!expanded}
        className="rounded-lg border border-border bg-surface p-5"
      >
        <legend className="px-1 text-sm font-medium">{copy.repeatLegend}</legend>
        <p className="text-sm text-muted">{copy.repeatDescription}</p>
        <RepeatFields
          startDate={startDate}
          disabled={!expanded}
          copy={{
            howOftenLabel: copy.howOftenLabel,
            doesntRepeat: copy.doesntRepeat,
            everyWeek: copy.everyWeek,
            every2Weeks: copy.every2Weeks,
            every4Weeks: copy.every4Weeks,
            repeatsOnLabel: copy.repeatsOnLabel,
            everyDay: copy.everyDay,
            endsLabel: copy.endsLabel,
            endsNever: copy.endsNever,
            endsOnChoice: copy.endsOnChoice,
            endsOnLabel: copy.endsOnLabel,
            weekdayNames: more.weekdayNames,
          }}
        />
      </fieldset>
      {/* The rare half, collapsed by default (design principles #8). The hint
          names what is behind it — a bare "More options" would hide the
          multi-day and repeat mechanisms behind a shrug. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className={buttonClass({ variant: "link", size: "sm" })}
        >
          {/* The affordance a ghost button has none of: which way this goes,
              before you press it. Decorative — `aria-expanded` is the state a
              screen reader is told. */}
          <DisclosureCaret className={expanded ? "rotate-90" : ""} />{" "}
          {expanded ? copy.fewerOptions : copy.moreOptions}
        </button>
        {expanded ? null : (
          <span className="text-sm text-muted">{copy.moreOptionsDescription}</span>
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
 * Departures sit under the shop-local day they sail on, and each row's actions —
 * slide it to another day or time, copy it forward, take it back off the board —
 * sit behind one quiet "⋯" disclosure per row, so the board at rest is the
 * schedule, not a grid of buttons. "Add a departure" opens under whichever day header the
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
/**
 * How long the row menu's fold runs before React unmounts it. It must outlast
 * the slowest child of `.animate-board-menu-out` in `globals.css` — the last
 * button's 100ms stagger plus its 280ms fold — or the fold is cut off partway.
 * Change one and change the other.
 */
const MENU_CLOSE_MS = 390;

/**
 * The crew signature this board mostly runs with, or `null` when it has none.
 *
 * A signature is the assignment in the order the row already prints it, so two
 * departures crewed by the same two people in a different order count as two
 * different answers — which is the honest reading, since that ordering is the
 * shop's own (lead first) rather than incidental.
 *
 * Returns `null` unless one signature covers at least three departures *and*
 * more than half the window. Both halves matter: below three, a per-row line
 * still reads as the exception it is, and without the majority there is no
 * "usual" to state. Departures with nobody assigned are excluded from the vote
 * and can never win it.
 */
function mostCommonCrew(trips: readonly { crew: string[] }[]): string[] | null {
  const counts = new Map<string, { crew: string[]; count: number }>();
  for (const trip of trips) {
    if (trip.crew.length === 0) continue;
    const key = trip.crew.join("\u0000");
    const seen = counts.get(key);
    if (seen) seen.count += 1;
    else counts.set(key, { crew: trip.crew, count: 1 });
  }
  let best: { crew: string[]; count: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  if (!best || best.count < 3 || best.count * 2 <= trips.length) return null;
  return best.crew;
}

/** Does this departure run with the board's usual crew, in the same order? */
function isUsualCrew(crew: readonly string[], usual: readonly string[] | null): boolean {
  return usual !== null && crew.length === usual.length && crew.every((n, i) => n === usual[i]);
}

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
  initialSite,
  requestPlan,
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
  /** Set when the board was reached from a dive site's "schedule departure" control. */
  initialSite?: BuilderInitialSite | null;
  /** Requests selected from the Requests page, or null for an ordinary add. */
  requestPlan?: BuilderRequestPlan | null;
  /**
   * Whether to arrive with the add panel already open, and how deep. Every
   * former door to `/trips/new` now lands here instead, and a link that used to
   * open a whole page of form has to open something.
   */
  openAdd: "closed" | "quick" | "expanded";
}) {
  // One of `add:<dateIso>`, `move:<tripId>`, `copy:<tripId>`, or null.
  const [open, setOpen] = useState<string | null>(openAdd === "closed" ? null : "add:top");
  const [closingMenu, setClosingMenu] = useState<string | null>(null);
  const menuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The top add panel is opened by *links* — the header's "Add a departure",
  // the empty board's call to action, the former /trips/new doors — all of
  // which land as a `?add=` client navigation to this same route. The state
  // initializer above only covers a fresh mount, so a prop change (same
  // component instance, new search params) has to open the panel too, or the
  // header link works exactly once.
  useEffect(() => {
    if (openAdd !== "closed") setOpen("add:top");
  }, [openAdd]);

  // Cancelling that panel mirrors the link that opened it: clear the opening
  // params so the same link opens it again, and hand focus back to the header
  // control (server-rendered, so reached by its data attribute rather than a
  // ref). Cursor/notice params survive — only what opened the panel goes.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const cancelTopAdd = () => {
    setOpen(null);
    const params = new URLSearchParams(searchParams);
    for (const key of ["add", "date", "course", "requests", "site"]) params.delete(key);
    router.replace(`${pathname}${params.size > 0 ? `?${params}` : ""}`, { scroll: false });
    document.querySelector<HTMLElement>("[data-board-add]")?.focus();
  };

  // A shared fact belongs to the group, not the rows (principle 9): when every
  // departure on the board is unpriced, the per-row pill collapses into one
  // notice above the list. Three is the floor — below it, a pill per row still
  // reads as the exception it is.
  const windowTrips = days.flatMap((day) => day.trips);
  const unpricedCount = windowTrips.filter((trip) => trip.priceCents === null).length;
  const allUnpriced = unpricedCount >= 3 && unpricedCount === windowTrips.length;
  // The same principle, one row lower: a shop rosters the same two or three
  // people onto nearly everything, so "Crew: Keiko Tanaka, Sal Moretti" was
  // printing on ten of fourteen rows in the same grey — a third of the board's
  // ink, saying nothing that distinguishes one departure from another (issue
  // #757). The usual crew is stated once above the list and dropped from the
  // rows that match it; what is left on the rows is, by construction, the
  // exception a manager is scanning for.
  //
  // **The gate is stricter than the price banner's, and has to be.** Three
  // rows is the same floor, but this also demands a strict *majority* of the
  // window: on a board split 7/7 between two crews there is no "usual", and a
  // header claiming one would be a sentence about who is on which boat that is
  // wrong half the time. An unstaffed departure can never become the default —
  // it is not a crew, it is the gap this whole line exists to show.
  const usualCrew = mostCommonCrew(windowTrips);
  const closeMenu = useCallback((menuKey: string) => {
    setClosingMenu(menuKey);
    if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = setTimeout(() => {
      setOpen((current) => (current === menuKey ? null : current));
      setClosingMenu((current) => (current === menuKey ? null : current));
    }, MENU_CLOSE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (menuCloseTimer.current) clearTimeout(menuCloseTimer.current);
    };
  }, []);

  const toggle = (panel: string) => {
    if (open === panel) {
      if (panel.startsWith("menu:")) closeMenu(panel);
      else setOpen(null);
      return;
    }
    setClosingMenu(null);
    setOpen(panel);
  };

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
    setClosingMenu(null);
    setOpen(null);
    toggleRefs.current[key]?.focus();
  };

  // A row's "⋯" action list is the one open-able thing here that isn't a form:
  // it should dismiss the way any disclosed menu does — Escape hands focus back
  // to the trigger, a click anywhere else simply closes it (focus stays where
  // the person clicked). Forms keep their explicit Cancel instead — half-typed
  // work must never be swallowed by a stray click — so both listeners exist
  // only while a menu is open.
  useEffect(() => {
    if (!open?.startsWith("menu:")) return;
    const menuKey = open;
    const tripId = open.slice("menu:".length);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(`[data-row-menu="${CSS.escape(tripId)}"]`))
        return;
      closeMenu(menuKey);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(menuKey);
      toggleRefs.current[menuKey]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeMenu]);

  // The schedule route has no dynamic id, so if `cacheComponents: true`'s
  // Activity-based navigation is ever re-enabled, this instance could
  // otherwise be preserved across a navigate-away-and-back with a panel left
  // expanded and its defaults stale (docs ADR
  // 20260801-cache-components-activity-state, currently reverted, commit
  // 100fcf8). Reset on the leading edge of any (re)navigation, same pattern
  // as InlineConfirm.
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
  //
  // It resets to *what the URL asks for*, not to null. Closing unconditionally
  // was not idempotent, and an effect that isn't gets run twice on every mount
  // in development (React StrictMode): first pass armed the ref, second pass
  // immediately shut the panel the first pass had just been told to open. That
  // took out every cross-route door to this form at once — the catalogue's
  // "schedule a session of this course", the `/trips/new` 308, a pasted
  // `?add=full` — each of which lands as a fresh mount carrying `openAdd`.
  // Re-deriving from `openAdd` makes a second run a no-op and still resets a
  // stale panel on a genuine re-navigation, which is what the reset is for.
  const pathnameEffectRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change re-derives the panel from the URL, which is the point.
  useEffect(() => {
    if (!pathnameEffectRan.current) {
      pathnameEffectRan.current = true;
      return;
    }
    setOpen(openAdd === "closed" ? null : "add:top");
  }, [pathname]);

  return (
    <section aria-label={copy.ariaLabel} className="mb-8">
      {/* No top "Add a departure" band: that control lives in the page
          header's action cluster (a Link to `?add=1` in page.tsx) rather than
          holding a stratum of its own whose only content duplicated the "+
          Add" every day header already carries (principle 8/9). The panel it
          opens still renders here, keyed "add:top", via `openAdd`. */}

      {/* Creating a departure is owner/manager/instructor work (H-14); crew
          still read the board, so it says whose job this is rather than
          silently omitting every add control. */}
      {canConfigure ? null : (
        <p className="mb-3 rounded-xl border border-border bg-surface-sunken/50 p-4 text-sm text-muted">
          {copy.viewOnlyNotice}
        </p>
      )}

      {/* Keyed "add:top" rather than by its date: the header link and the
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
          initialSite={initialSite}
          requestPlan={requestPlan}
          startExpanded={openAdd === "expanded"}
          onAdd={actions.add}
          onCancel={cancelTopAdd}
        />
      ) : null}

      {/* When *every* departure in the window is unpriced (a brand-new board,
          an imported season), the per-row pill is the same fact repeated on
          every line — noise pretending to be information (design/principles.md
          #9). Said once up here instead; rows keep their pill only while some
          are priced and some are not, which is when a per-row mark actually
          distinguishes anything. Three is the floor so one lone unpriced
          departure keeps its own pill rather than becoming a banner. */}
      {allUnpriced ? (
        <p className="mt-4 rounded-xl border border-warning/40 bg-surface p-4 text-sm font-medium text-warning">
          {copy.noPriceSetAll}
        </p>
      ) : null}

      {/* Not a banner: the usual crew is not a problem to solve, it is the
          answer the rows below no longer have to repeat. Muted and inline, in
          the caption voice those rows used to carry. */}
      {usualCrew ? (
        <p className="mt-4 text-sm text-muted">
          {fill(copy.crewMostlyAll, { names: usualCrew.join(", ") })}
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-8">
        {days.map((day) => (
          <div key={day.dateIso}>
            {/* The day header is the public schedule's calendar block — big
                day numeral, weekday and month as its caps, a hairline running
                out to the day's own "+ Add". The numeral is what a scrolling
                thumb catches; the sr-only sentence keeps the date readable in
                one piece for screen readers.

                Sticky like the storefront's, so mid-scroll the rows under a
                thumb always name their day — but pinned *below* the staff
                header (sticky top-0, 69px tall; 68 tucks 1px under its border
                so no slit of scrolling content shows between them). z-20 keeps
                it above the rows' own z-10 action clusters; the row "⋯" menus
                disclose inline rather than floating, so nothing needs to paint
                over a pinned header. The day's "+ Add" rides inside the sticky
                row, so the affordance travels with the day. */}
            <div className="sticky top-[68px] z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-background pt-2 pb-2">
              <h3 className="flex items-center gap-3">
                <span className="sr-only">{day.label}</span>
                <span aria-hidden="true" className="flex items-center gap-3">
                  <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
                    {day.parts.day}
                  </span>
                  <span className="flex flex-col justify-center leading-tight">
                    <span className="text-xs font-bold tracking-[0.18em] uppercase">
                      {day.parts.weekday}
                    </span>
                    <span className="text-xs font-medium tracking-[0.18em] text-muted uppercase">
                      {day.parts.month}
                    </span>
                  </span>
                </span>
              </h3>
              <span aria-hidden="true" className="h-px min-w-8 flex-1 bg-border" />
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
            {day.boatWarning ? (
              <div className="mt-2 rounded-lg border border-warning/40 bg-warning-tint px-3 py-2 text-xs font-medium text-warning flex items-center gap-2">
                <span aria-hidden="true">⚠️</span>
                <span>{day.boatWarning}</span>
              </div>
            ) : null}
            {canConfigure && open === `add:${day.dateIso}` ? (
              <AddPanel
                dateIso={day.dateIso}
                options={options}
                price={price}
                copy={copy}
                more={more}
                initialCourse={null}
                requestPlan={null}
                startExpanded={false}
                onAdd={actions.add}
                onCancel={() => closePanel(`add:${day.dateIso}`)}
              />
            ) : null}

            <ul className="mt-2 flex flex-col">
              {day.trips.map((trip) => {
                const full = trip.booked >= trip.capacity;
                // "Copy" is designed to mint a same-titled departure on another
                // day, so the title alone is never a unique accessible name for
                // these controls. Day and time make it one.
                const ref = `${trip.title}, ${day.label} ${trip.timeRange}`;
                return (
                  <li
                    key={trip.id}
                    // Borderless, like the public agenda's rows: the day blocks,
                    // type, and whitespace carry the hierarchy, and the hover
                    // tint says "this row is a thing" without a box saying it
                    // permanently (design/principles.md #10). The open panels
                    // below keep their own bordered boxes — a form is a form.
                    className="group/trip -mx-3 rounded-xl px-3 py-4 transition-colors hover:bg-surface has-[a:focus-visible]:bg-surface sm:-mx-4 sm:px-4"
                  >
                    {/* Two columns, not six loose flex children. The time, the
                        title block, the badges and the buttons all used to sit
                        side by side under `items-start`, so a short badge and
                        an 11-unit-tall button row hung off the top of a
                        three-line title at three different heights and nothing
                        lined up with anything. Now: what the departure *is* on
                        the left, what you *do* about it on the right, each
                        internally aligned.
                        `relative` scopes the title's stretched pseudo-element
                        to this summary block only — the move/copy/remove
                        panels below stay outside the row's tap target. */}
                    <div className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
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
                          {/* The whole summary is the tap target, phone
                              included: the title link stretches over it via
                              its pseudo-element (the public agenda's own
                              mechanic — a borderless row with only a text
                              link reads as a listing, not a pressable
                              thing). The badges and the "⋯" menu opt back on
                              top with z-10; the accessible name stays the
                              plain title the tests and specs click. */}
                          <Link
                            href={`/shop/${shopSlug}/trips/${trip.id}`}
                            className="font-medium group-hover/trip:text-primary after:absolute after:inset-0 after:z-0"
                          >
                            {trip.title}
                          </Link>
                          <p className="mt-0.5 text-sm text-muted">
                            {[
                              trip.boatName ? `⛵ ${trip.boatName}` : null,
                              trip.diveMode === "shore" ? copy.modeShore : null,
                              trip.diveMode === "pool" ? copy.modePool : null,
                              trip.courseTitle
                                ? fill(copy.courseLabel, { title: trip.courseTitle })
                                : null,
                              trip.diveSiteName,
                              trip.dayCount > 1
                                ? fill(
                                    pluralForm(trip.dayCount, {
                                      one: copy.dayCountLabelOne,
                                      other: copy.dayCountLabelOther,
                                    }),
                                    { count: trip.dayCount },
                                  )
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || copy.noSiteSetYet}
                          </p>
                          {/* Dropped entirely when this departure runs with the
                              board's usual crew, which is stated once above the
                              list (principle 9). What survives is an exception,
                              so it sheds the muted class in that case — a line
                              that is only printed when it differs should not
                              read like the caption it replaced. With no usual
                              crew to hoist, every row keeps its line in the old
                              caption grey. "Nobody yet" is warning ink either
                              way: that is the gap this line exists to show. */}
                          {isUsualCrew(trip.crew, usualCrew) ? null : (
                            <p className={`mt-1 text-sm ${usualCrew ? "" : "text-muted"}`}>
                              {trip.crew.length > 0 ? (
                                `${copy.crewLabel} ${trip.crew.join(", ")}`
                              ) : (
                                <>
                                  {copy.crewLabel}{" "}
                                  <span className="font-medium text-warning">
                                    {copy.crewNobodyYet}
                                  </span>
                                </>
                              )}
                            </p>
                          )}
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
                          then what you can do about it, on one centred line.
                          `z-10` lifts its own links and the "⋯" controls above
                          the title's stretched overlay. */}
                      <div className="relative z-10 flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                        {/* Counts are facts, not alerts (design/principles.md
                            #9): a routine 5/12 reads as quiet tabular text, the
                            same register the public schedule gives "7 spots
                            left". Only the sold-out boat keeps a badge — a win
                            worth noticing (#3), "success" where "neutral" would
                            recede, matching the same badge on the trip page. */}
                        {full ? (
                          <Badge tone="success" tabularNums>
                            {trip.booked}/{trip.capacity}
                          </Badge>
                        ) : (
                          <p className="text-sm text-muted tabular-nums">
                            {trip.booked}/{trip.capacity}
                          </p>
                        )}
                        {/* The loudest thing this board can say (DOM-H3): the
                            boat is back and somebody on its list was never
                            counted. "danger" carries an aria-hidden ✕ of its
                            own, so hue is never the only signal, and the whole
                            badge is a link straight to the open checkpoint. */}
                        {/* `min-h-11` on both badge links: the badge stays its
                            size, the hit area clears the 44px dock-test bar —
                            the roll-call one is the most safety-adjacent tap
                            on this board and must not be its smallest. */}
                        {trip.rollCallOpen ? (
                          <Link
                            href={`/shop/${shopSlug}/trips/${trip.id}/manifest?checkpoint=after_dive_${trip.rollCallOpen.diveNumber}`}
                            aria-label={fill(copy.rollCallOpenAria, {
                              ref,
                              dive: trip.rollCallOpen.diveNumber,
                            })}
                            className="inline-flex min-h-11 items-center"
                          >
                            <Badge tone="danger">
                              {fill(copy.rollCallOpen, { count: trip.rollCallOpen.uncounted })}
                            </Badge>
                          </Link>
                        ) : null}
                        {trip.priceCents === null && !allUnpriced ? (
                          <Link
                            href={`/shop/${shopSlug}/trips/${trip.id}#details`}
                            aria-label={fill(copy.noPriceSetAria, { ref })}
                            className="inline-flex min-h-11 items-center"
                          >
                            <Badge tone="warning">{copy.noPriceSet}</Badge>
                          </Link>
                        ) : null}
                        {/* Move/copy/remove are all refused by `src/db/trips.ts`
                            for a departure that has already sailed, and a
                            returned row is only here to have its head count
                            closed — so it gets the badge and nothing that would
                            bounce. The three actions sit behind one quiet "⋯"
                            control rather than three always-on buttons: a board
                            of twenty rows used to render sixty same-weight
                            buttons — a red Remove on every one — for actions a
                            staffer takes on one row at a time (design
                            principles #8, "collapse the rare path"). The
                            content is the row; the controls appear when asked. */}
                        {canConfigure && !trip.rollCallOpen ? (
                          <div data-row-menu={trip.id} className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              ref={registerToggle(`menu:${trip.id}`)}
                              onClick={() => toggle(`menu:${trip.id}`)}
                              aria-expanded={open === `menu:${trip.id}`}
                              aria-label={fill(copy.rowActionsAria, { ref })}
                              className={buttonClass({
                                variant: "ghost",
                                size: "sm",
                                className: "min-w-11",
                              })}
                            >
                              {/* Decorative — the aria-label above names what
                                  this discloses, per row, uniquely. */}
                              <span aria-hidden="true" className="tracking-wider">
                                ⋯
                              </span>
                            </button>
                            {/* The three choices disclose *inline*, unfolding
                                beside the "⋯" that revealed them, never as a
                                floating panel. On these borderless rows a
                                dropdown hung over whatever sat beneath it —
                                the next day's "+ Add" ended up 18px from
                                fully covered, an automated-scan WCAG 2.5.8
                                failure. Inline, nothing can ever be obscured,
                                and the actions sit beside the row they act on
                                (design/principles.md #10). */}
                            {open === `menu:${trip.id}` || closingMenu === `menu:${trip.id}` ? (
                              <div
                                className={`flex items-center gap-1 ${
                                  closingMenu === `menu:${trip.id}`
                                    ? "pointer-events-none animate-board-menu-out"
                                    : "animate-board-menu-in"
                                }`}
                              >
                                <button
                                  type="button"
                                  ref={focusOnMount}
                                  onClick={() => toggle(`move:${trip.id}`)}
                                  aria-label={fill(copy.moveAria, { ref })}
                                  className={buttonClass({
                                    variant: "ghost",
                                    size: "sm",
                                  })}
                                >
                                  {copy.move}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggle(`copy:${trip.id}`)}
                                  aria-label={fill(copy.copyAria, { ref })}
                                  className={buttonClass({
                                    variant: "ghost",
                                    size: "sm",
                                  })}
                                >
                                  {copy.copy}
                                </button>
                                {/* Remove opens a panel like Move and Copy do,
                                    rather than swapping itself for an
                                    `InlineConfirm` message card in place. That
                                    card is built to be a block of its own, and
                                    wedged inline it shoved every row beneath it
                                    around while the staffer read the sentence.
                                    It is still two deliberate steps: this item
                                    submits nothing, and the panel below holds
                                    the only real submit. */}
                                <button
                                  type="button"
                                  onClick={() => toggle(`remove:${trip.id}`)}
                                  aria-label={fill(copy.removeAria, { ref })}
                                  className={buttonClass({
                                    variant: "danger-ghost",
                                    size: "sm",
                                  })}
                                >
                                  {copy.remove}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                        {/* The row's one at-rest tap cue, same as the public
                            agenda's: without a border, a phone row — where
                            hover doesn't exist — reads as a text listing
                            rather than a pressable thing. Decorative; the
                            title link is the navigation. */}
                        <span
                          aria-hidden="true"
                          className="text-muted transition-transform group-hover/trip:translate-x-0.5"
                        >
                          ›
                        </span>
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
                            onClick={() => closePanel(`menu:${trip.id}`)}
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
                            onClick={() => closePanel(`menu:${trip.id}`)}
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
                            defaultValue={shiftCalendarDate(trip.dateIso, 7)}
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
                            onClick={() => closePanel(`menu:${trip.id}`)}
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
