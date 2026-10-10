"use client";

import { FormDraft, type FormDraftActions, type FormDraftProps } from "@/components/FormDraft";
import { RepeatFields } from "@/components/RepeatFields";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { TripDiveFields } from "@/components/TripDiveFields";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { ForgivingInput } from "@/components/ui/ForgivingInput";
import {
  ChoiceRow,
  controlClass,
  DateField,
  Field,
  FieldGrid,
  legendClass,
  textareaClassFor,
} from "@/components/ui/form";
import { fill, pluralForm } from "@/i18n/fill";
import {
  MAX_DECISION_HOURS,
  MAX_MINIMUM_BOOKINGS,
  MIN_DECISION_HOURS,
  MINIMUM_SEATS_DECISION_HOURS_DEFAULT,
} from "@/lib/minimum-seats";

import type {
  BuilderCopy,
  BuilderCourseOption,
  BuilderInitialCourse,
  BuilderInitialSite,
  BuilderMoreOptions,
  BuilderOptions,
  BuilderPattern,
  BuilderPriceInput,
  BuilderRequestPlan,
  BuilderTideWindowInput,
  DiveMode,
} from "./builder-types";
import { focusOnMount } from "./focus-on-mount";
import { useAddPanel } from "./use-add-panel";

/**
 * The frame of each group the add panel's "More options" opens: Pay at
 * booking, the Dive plan and Repeat. One spelling, so a sibling cannot drift
 * from the others: the Dive plan once carried its own 20px corner and 16px
 * phone inset between two of these (pixel-craft K-95).
 */
const GROUP_FRAME = "rounded-lg border border-border bg-surface p-5";

/** What every add panel on the board shares, built once by `ScheduleBuilder`: the draft, the loaders, the options and the words. */
export type AddPanelBuilder = {
  /** The reader's language, for the time fields' readings. */
  locale: string;
  /** What this person had typed into the add panel when they last left it, if fresh. */
  addDraft: FormDraftProps["draft"];
  draftActions: FormDraftActions;
  /** The weekday's pattern, fetched when the panel opens with nothing else to say. */
  loadPattern?: (dateIso: string) => Promise<BuilderPattern | null>;
  /** The tide at the chosen site for this departure, worded; null renders nothing. */
  loadTideWindow?: (input: BuilderTideWindowInput) => Promise<string | null>;
  /** `null` until the panel's own fetch lands; the selects say so meanwhile. */
  options: BuilderOptions | null;
  price: BuilderPriceInput;
  copy: BuilderCopy;
  more: BuilderMoreOptions;
  // i18n-exempt: type annotation, not copy — the scanner misreads the union as a string.
  onAdd: (formData: FormData) => void | Promise<void>;
};

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
export function AddPanel({
  builder,
  dateIso,
  initialCourse,
  initialSite,
  requestPlan,
  startExpanded,
  onCancel,
}: {
  builder: AddPanelBuilder;
  dateIso: string;
  initialCourse: BuilderInitialCourse | null;
  initialSite?: BuilderInitialSite | null;
  requestPlan?: BuilderRequestPlan | null;
  /** Opened straight into its full depth — a link that meant the whole form. */
  startExpanded: boolean;
  onCancel: () => void;
}) {
  const {
    locale,
    addDraft,
    draftActions,
    loadPattern,
    loadTideWindow,
    options,
    price,
    copy,
    more,
    onAdd,
  } = builder;
  const {
    expanded,
    courseId,
    setCourseId,
    offeredModes,
    diveMode,
    setDiveMode,
    selectedBoatId,
    setSelectedBoatId,
    capacity,
    setCapacity,
    plannedDives,
    setPlannedDives,
    diveSiteId,
    setDiveSiteId,
    diveSeed,
    toggleExpanded,
    startDate,
    setStartDate,
    tideLine,
    tideAnchor,
    patternAnchor,
    pattern,
    patternApplied,
    lensId,
    setLensId,
    crew,
    setCrew,
    startBlank,
    crewNames,
  } = useAddPanel({
    locale,
    addDraft,
    loadPattern,
    loadTideWindow,
    dateIso,
    options,
    initialCourse,
    initialSite,
    requestPlan,
    startExpanded,
  });
  // Here rather than in the hook, so the check narrows `initialCourse` below.
  const onCourse = initialCourse !== null && courseId === initialCourse.id;

  return (
    <FieldGrid
      as="form"
      action={onAdd}
      columns={1}
      className="mt-3 rounded-inset border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
    >
      <span ref={patternAnchor} className="contents" />
      {pattern && patternApplied ? (
        <p
          role="status"
          className={`flex flex-wrap items-center gap-x-1 gap-y-1 ${INSET_NOTE_BOX} bg-surface-sunken`}
        >
          <span>
            {fill(copy.patternFilled, {
              count: pattern.sampledDays,
              weekday: more.weekdayNames[pattern.weekday] ?? "",
            })}
          </span>
          <button
            type="button"
            onClick={startBlank}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {copy.patternStartBlank}
          </button>
        </p>
      ) : null}
      {/* Nothing you typed is lost (ADR 20260906-before-you-ask, decision 3):
          the desk's half-filled panel picks up here, and the line says so. */}
      <FormDraft
        form="add_departure"
        draft={addDraft}
        actions={draftActions}
        copy={{ pickedUp: copy.draftPickedUp, startOver: copy.draftStartOver }}
      />
      {requestPlan ? (
        /* Pinned under the chrome bar, not at a hand-picked 16px: `top-4` put
           this brief *behind* the bar the moment the page scrolled, which is
           the same defect the day headers had. It reads `--chrome-h` like they
           do (ADR 20260827-clearwater-surface-language, decision 10). */
        <fieldset className="sticky top-(--chrome-h) z-10 rounded-lg border border-primary/30 bg-primary/5 p-4 shadow-sm">
          <legend className={`${legendClass} text-sm font-semibold text-primary`}>
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
                <ChoiceRow
                  type="checkbox"
                  name="inquiryId"
                  value={request.id}
                  defaultChecked
                  className="rounded-lg bg-surface px-3 py-2 text-sm"
                >
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
                </ChoiceRow>
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
          className={textareaClassFor(2)}
        />
      </Field>
      {/* A box's row, never a `Field`: `Field` wraps a child that is not one
          control in a `<label>` of its own, so a row inside one is a label in
          a label, and `items-center` hung the box between the words and their
          hint rather than on the words (K-13). The wrapper carries `hidden`,
          as the field did. */}
      <div className={expanded ? undefined : "hidden"}>
        <ChoiceRow
          type="checkbox"
          name="isPrivate"
          value="true"
          disabled={!expanded}
          className="text-sm font-medium"
        >
          <span className="block">{copy.isPrivateLabel}</span>
          <span className="block text-xs font-normal text-muted">{copy.isPrivateHint}</span>
        </ChoiceRow>
      </div>
      <FieldGrid columns={3} className="gap-y-4">
        <Field label={copy.date}>
          {/* Read here as well as submitted: the repeat fieldset below pre-checks
              this date's own weekday, so it has to see the date change. */}
          <DateField
            name="date"
            required
            defaultValue={dateIso}
            onChange={(event) => setStartDate(event.currentTarget.value)}
          />
        </Field>
        {/* "7" is 7:00 AM and "1p" is 1:00 PM (ADR 20260906-before-you-ask,
            decision 3): the box takes what the desk says and submits the HH:MM
            a native time control would have. */}
        <Field label={copy.departs}>
          <ForgivingInput
            kind="time"
            name="startTime"
            required
            defaultValue="08:30"
            locale={locale}
            copy={{ typedAs: copy.typedAs }}
          />
        </Field>
        <Field label={copy.returns}>
          <ForgivingInput
            kind="time"
            name="endTime"
            required
            defaultValue="12:30"
            locale={locale}
            copy={{ typedAs: copy.typedAs }}
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
          className={`${controlClass} tabular-nums max-w-40`}
        />
      </Field>
      {offeredModes.length > 1 ||
      (options?.boats && options.boats.length > 0) ||
      (options?.lenses && options.lenses.length > 0) ? (
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
          {/* The shop's own word for this kind of day (ADR
              20260904-reef-all-the-way-down, decision 2). Rendered only when
              the shop has written a vocabulary, the same silence the hull
              select keeps with no boats. */}
          {options?.lenses && options.lenses.length > 0 ? (
            <Field label={copy.lensLabel ?? "Trip tag"} hint={copy.optional}>
              <select
                name="lensId"
                value={lensId}
                onChange={(event) => {
                  setLensId(event.target.value);
                }}
                className={controlClass}
              >
                <option value="">{copy.lensNone ?? "None"}</option>
                {options.lenses.map((lens) => (
                  <option key={lens.id} value={lens.id}>
                    {lens.title}
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
            className={`${controlClass} tabular-nums max-w-40`}
          />
        </Field>
      </FieldGrid>
      {/* `<fieldset disabled>` reaches every control inside it, so this whole
          block leaves the submission in one attribute while it is hidden.
          Its number boxes are capped at every width, a `max-w-*` beside
          `controlClass`'s `w-full` (two `w-*` would race by stylesheet
          order): `sm:w-*` alone let each box on a phone fill whatever its
          suffix left, four widths in one stack (K-332). */}
      {/* A legend names this payment control group; it must remain a
          fieldset rather than becoming a generic SectionCard. */}
      <fieldset hidden={!expanded} disabled={!expanded} className={GROUP_FRAME}>
        <legend className={`${legendClass} text-sm font-medium`}>{copy.payAtBookingLegend}</legend>
        <p className="text-sm text-muted">{copy.payAtBookingDescription}</p>
        <FieldGrid columns={2} className="mt-4">
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
              className={`${controlClass} tabular-nums max-w-40`}
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
                className={`${controlClass} tabular-nums max-w-28`}
              />
              <span className="whitespace-nowrap text-sm text-muted">{copy.hoursSuffix}</span>
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
                className={`${controlClass} tabular-nums max-w-28`}
              />
              <span className="whitespace-nowrap text-sm text-muted">{copy.diversSuffix}</span>
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
                className={`${controlClass} tabular-nums max-w-28`}
              />
              <span className="whitespace-nowrap text-sm text-muted">{copy.hoursBeforeSuffix}</span>
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
        {/* Offered at creation, not only on the trip's own edit form. The shape
            this exists for is a *standing* unguided charter — created once as a
            series template and materialized weekly — so a mark you can only
            apply after the fact is a mark the case it was built for never gets
            in time (issue #973). */}
        {/* **Absent once a course is picked** (issue #1342), not merely
            ignored: the mark silences the shop's own divemaster target, and a
            departure running a course has an instructor of record, so that
            target is exactly the signal that should keep applying to it.
            `insertTripInstance` refuses the combination whatever this form
            posts, and a control that has no effect is worse than one that is
            not there.

            **Below the course select, deliberately**, though it reads as an
            odd place for it. Above, a staffer could tick this, scroll down,
            pick a course, and never see the box disappear — on a phone at the
            desk it goes off the top of the fold and they leave believing
            something about the day that is not true. The control that governs
            it is now read first. The input stays uncontrolled, so switching
            back to an ordinary trip restores whatever they had ticked. */}
        {/* Beside the course select, in its control row: the wrapper takes a
            field's two rows (an empty caption, then the box) the way `Field`
            does, without `Field`'s wrapping label around a label (K-13).
            Only from `sm`, where there is a neighbour's caption to share: on a
            phone it stacks under the select, and the empty caption track and
            its 4px gutter set the box 4px lower than the private row (K-330). */}
        <div
          className={`grid min-w-0 sm:row-span-2 sm:grid-rows-subgrid sm:gap-y-1 ${expanded && courseId === "" ? "" : "hidden"}`}
        >
          <ChoiceRow
            type="checkbox"
            name="selfGuided"
            value="true"
            disabled={!expanded || courseId !== ""}
            className="self-start text-sm font-medium sm:row-start-2"
          >
            <span className="block">{copy.selfGuidedLabel}</span>
            <span className="block text-xs font-normal text-muted">{copy.selfGuidedHint}</span>
          </ChoiceRow>
        </div>
        {/* One site for the day, or — expanded — `dive-N-siteId` per dive.
            Never both: dive one's select is seeded from this one on the first
            expansion and writes back to it, so the two never disagree. */}
        <Field
          label={copy.diveSite}
          hint={copy.optional}
          description={tideLine}
          className={expanded ? "hidden" : undefined}
        >
          <select
            ref={tideAnchor}
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
          firstDiveSiteDescription={tideLine}
          copy={more.diveFields}
          frameClassName={GROUP_FRAME}
        />
      )}
      {/* A legend names this recurrence control group; it must remain a
          fieldset rather than becoming a generic SectionCard. */}
      <fieldset hidden={!expanded} disabled={!expanded} className={GROUP_FRAME}>
        <legend className={`${legendClass} text-sm font-medium`}>{copy.repeatLegend}</legend>
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
      {crew.length > 0 ? (
        <Field label={copy.crewLabel}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ul className="contents">
              {crew.map((member) => (
                <li
                  key={member.id}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 font-medium"
                >
                  <input type="hidden" name="crewPersonIds" value={member.id} />
                  {member.name}
                  <button
                    type="button"
                    aria-label={`${copy.remove}: ${member.name}`}
                    onClick={() => setCrew((current) => current.filter((c) => c.id !== member.id))}
                    className="ms-1 rounded-full px-1 text-muted hover:text-foreground"
                  >
                    {/* The crew row's drawn cross (pixel-craft K-545), at the chip's 14px. */}
                    <DiveDayIcon name="close" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            <span className="text-muted">{fill(copy.patternCrew, { names: crewNames })}</span>
          </div>
        </Field>
      ) : null}
      {pattern?.alsoUsual && patternApplied ? (
        <ChoiceRow
          type="checkbox"
          name="alsoUsualStart"
          value={pattern.alsoUsual.startTime}
          // The pattern line's box: the two sunken lines in this panel share
          // one inset (pixel-craft class 12).
          className={`${INSET_NOTE_BOX} bg-surface-sunken`}
        >
          <span className="block">
            {fill(pattern.alsoUsual.title ? copy.patternAlsoUsual : copy.patternAlsoUsualUntitled, {
              time: pattern.alsoUsual.timeLabel,
              title: pattern.alsoUsual.title ?? "",
              count: pattern.alsoUsual.days,
            })}
          </span>
          <span className="block font-medium">{copy.patternAddAlso}</span>
        </ChoiceRow>
      ) : null}
      {/* The rare half, collapsed by default (design principles #8). The hint
          names what is behind it — a bare "More options" would hide the
          multi-day and repeat mechanisms behind a shrug. `flush` starts the
          caret on the column every label above it starts on (K-223); the 12px
          of padding it gives up comes back in the row's gap, so the hint stays
          24px after the words. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          className={buttonClass({ variant: "link", size: "sm", flush: true })}
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
        <button type="button" onClick={onCancel} className={buttonClass({ variant: "ghost" })}>
          {copy.cancel}
        </button>
      </div>
    </FieldGrid>
  );
}
