"use client";

import { MeetingDaysField } from "@/app/shop/[shopSlug]/_components/MeetingDaysField";
import { FormDraft, type FormDraftActions, type FormDraftProps } from "@/components/FormDraft";
import { TripDiveFields } from "@/components/TripDiveFields";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { ForgivingInput } from "@/components/ui/ForgivingInput";
import { ChoiceRow, controlClass, DateField, Field, FieldGrid } from "@/components/ui/form";
import { fill } from "@/i18n/fill";
import { maxPlannedDives } from "@/lib/trip-dive-limits";
import {
  CapacityField,
  CourseSelect,
  DayKindSelects,
  DescriptionAndPrivacy,
  GROUP_FRAME,
  PanelFooter,
  PatternCrew,
  PatternNote,
  PayAtBookingGroup,
  PriceInputGroup,
  RepeatGroup,
  RequestPlanBrief,
} from "./add-panel-groups";
import type {
  BuilderCopy,
  BuilderInitialCourse,
  BuilderInitialSite,
  BuilderMoreOptions,
  BuilderOptions,
  BuilderPattern,
  BuilderPriceInput,
  BuilderRequestPlan,
  BuilderTideWindowInput,
} from "./builder-types";
import { focusOnMount } from "./focus-on-mount";
import { useAddPanel } from "./use-add-panel";

function diveFieldCountProps(courseId: string, plannedDives: number) {
  return { count: plannedDives, maxDives: maxPlannedDives(courseId !== "") };
}

/** What every add panel on the board shares, built once by `ScheduleBuilder`: the draft, the loaders, the options and the words. */
export type AddPanelBuilder = {
  /** The reader's language, for the time fields' readings. */
  locale: string;
  returnWeek?: string;
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
  standalone = false,
  onCancel,
}: {
  builder: AddPanelBuilder;
  dateIso: string;
  initialCourse: BuilderInitialCourse | null;
  initialSite?: BuilderInitialSite | null;
  requestPlan?: BuilderRequestPlan | null;
  /** Opened straight into its full depth — a link that meant the whole form. */
  startExpanded: boolean;
  standalone?: boolean;
  onCancel: () => void;
}) {
  const {
    locale,
    returnWeek,
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
    markPatternEdited,
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
  const selectedBoat =
    diveMode === "boat" ? options?.boats?.find((boat) => boat.id === selectedBoatId) : undefined;

  return (
    <FieldGrid
      as="form"
      action={onAdd}
      onInputCapture={markPatternEdited}
      onChangeCapture={markPatternEdited}
      columns={1}
      className={
        standalone
          ? "mt-3 gap-y-4"
          : "mt-3 rounded-inset border border-border bg-surface-sunken/50 p-4 gap-y-4 animate-scale-in"
      }
    >
      {returnWeek ? <input type="hidden" name="boardWeek" value={returnWeek} /> : null}
      <span ref={patternAnchor} className="contents" />
      <PatternNote
        copy={copy}
        pattern={patternApplied ? pattern : null}
        weekdayNames={more.weekdayNames}
        startBlank={startBlank}
      />
      {/* Nothing you typed is lost (ADR 20260906-before-you-ask, decision 3):
          the desk's half-filled panel picks up here, and the line says so. */}
      <FormDraft
        form="add_departure"
        draft={addDraft}
        actions={draftActions}
        copy={{ pickedUp: copy.draftPickedUp, startOver: copy.draftStartOver }}
      />
      {requestPlan ? <RequestPlanBrief copy={copy} requestPlan={requestPlan} /> : null}
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
      <DescriptionAndPrivacy copy={copy} expanded={expanded} />
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
      <MeetingDaysField
        copy={{
          daysLabel: copy.daysLabel,
          daysDescription: copy.daysDescription,
          dayLabel: copy.meetingDayLabel,
        }}
        minDays={more.minDays}
        maxDays={more.maxDays}
        defaultCount={more.minDays}
        disabled={!expanded}
        className={expanded ? undefined : "hidden"}
      />
      <DayKindSelects
        copy={copy}
        options={options}
        offeredModes={offeredModes}
        diveMode={diveMode}
        setDiveMode={setDiveMode}
        selectedBoatId={selectedBoatId}
        setSelectedBoatId={setSelectedBoatId}
        setCapacity={setCapacity}
        lensId={lensId}
        setLensId={setLensId}
      />
      <FieldGrid columns={2} className="gap-y-4">
        <CapacityField
          copy={copy}
          capacity={capacity}
          boatCapacity={selectedBoat?.capacity}
          setCapacity={setCapacity}
        />
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
            max={maxPlannedDives(courseId !== "")}
            value={Math.min(plannedDives, maxPlannedDives(courseId !== ""))}
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
          is capped, by `max-w-28`: a `w-28` beside `controlClass`'s `w-full`
          races by stylesheet order and lost (visual review A33). */}
      <PriceInputGroup copy={copy} price={price} />
      <PayAtBookingGroup copy={copy} price={price} expanded={expanded} />
      {/* Two columns in both states: `columns={expanded ? 1 : 2}` made the
          Course select jump from half-width to full on every toggle. */}
      <FieldGrid columns={2} className="gap-y-4">
        <CourseSelect
          copy={copy}
          options={options}
          initialCourse={initialCourse}
          onCourse={onCourse}
          courseId={courseId}
          setCourseId={setCourseId}
        />
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
            aria-busy={options === null ? true : undefined}
            className={`${controlClass}${options === null ? " animate-pulse" : ""}`}
          >
            <option value="">{copy.decideLater}</option>
            {initialSite && options === null ? (
              <option value={initialSite.id}>{initialSite.name}</option>
            ) : null}
            {(options?.diveSites ?? []).map((site) => (
              <option key={site.id} value={site.id}>
                {site.title}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      {diveSeed === null ? null : (
        <TripDiveFields
          diveSites={(options?.diveSites ?? []).map((site) => ({
            id: site.id,
            name: site.title,
          }))}
          {...diveFieldCountProps(courseId, plannedDives)}
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
      <RepeatGroup copy={copy} more={more} startDate={startDate} expanded={expanded} />
      <PatternCrew copy={copy} crew={crew} setCrew={setCrew} crewNames={crewNames} />
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
      <PanelFooter
        copy={copy}
        expanded={expanded}
        toggleExpanded={toggleExpanded}
        onCancel={onCancel}
      />
    </FieldGrid>
  );
}
