"use client";

import { RepeatFields } from "@/components/RepeatFields";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import {
  ChoiceRow,
  controlClass,
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
  BuilderMoreOptions,
  BuilderOptions,
  BuilderPattern,
  BuilderPriceInput,
  BuilderRequestPlan,
  DiveMode,
} from "./builder-types";

/**
 * The frame of each group the add panel's "More options" opens: Pay at
 * booking, the Dive plan and Repeat. One spelling, so a sibling cannot drift
 * from the others: the Dive plan once carried its own 20px corner and 16px
 * phone inset between two of these (pixel-craft K-95).
 */
export const GROUP_FRAME = "rounded-lg border border-border bg-surface p-5";

/** Pay at booking: deposit, cancellation window and the minimum head count, hidden and disabled until "More options". */
export function PayAtBookingGroup({
  copy,
  price,
  expanded,
}: {
  copy: BuilderCopy;
  price: BuilderPriceInput;
  expanded: boolean;
}) {
  return (
    <>
      {/* `<fieldset disabled>` reaches every control inside it, so this whole
        block leaves the submission in one attribute while it is hidden.
        Its number boxes are capped at every width, a `max-w-*` beside
        `controlClass`'s `w-full` (two `w-*` would race by stylesheet
        order): `sm:w-*` alone let each box on a phone fill whatever its
        suffix left, four widths in one stack (K-332). */}
      {/* A legend names this payment control group; it must remain a
        fieldset rather than becoming a generic SectionCard. */}
      {/* The paid-booking fields sit two by two from `sm` and in one row only
          from `lg` (visual review A44): four in a row at `md` wrapped every
          label. The deposit and its window, then the minimum and its deadline;
          "Free cancellation until" is short enough to sit on one line at 1280. */}
      <fieldset hidden={!expanded} disabled={!expanded} className={GROUP_FRAME}>
        <legend className={`${legendClass} text-sm font-medium`}>{copy.payAtBookingLegend}</legend>
        <p className="text-sm text-muted">{copy.payAtBookingDescription}</p>
        <FieldGrid columns={4} className="mt-4">
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
              className={`${controlClass} tabular-nums max-w-28`}
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
              <span className="whitespace-nowrap text-sm text-muted">{copy.hoursBeforeSuffix}</span>
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
    </>
  );
}

/**
 * The course select, grouped by agency, with the course this panel was opened
 * for already present while the catalogue is still in flight.
 */
export function CourseSelect({
  copy,
  options,
  initialCourse,
  onCourse,
  courseId,
  setCourseId,
}: {
  copy: BuilderCopy;
  options: BuilderOptions | null;
  initialCourse: BuilderInitialCourse | null;
  /** Whether the picked course is the one the panel was opened for. */
  onCourse: boolean;
  courseId: string;
  setCourseId: (courseId: string) => void;
}) {
  return (
    <Field
      label={copy.course}
      hint={copy.optional}
      description={
        onCourse && initialCourse
          ? fill(copy.courseNote, {
              requirement: initialCourse.requirement,
            })
          : undefined
      }
    >
      {/* While the catalogue is in flight the box pulses where its options
          will be and says no word (visual review A33): "Loading…" read as an
          option. The board usually hands the catalogue in with the page. */}
      <select
        name="courseId"
        value={courseId}
        onChange={(event) => setCourseId(event.target.value)}
        aria-busy={options === null ? true : undefined}
        className={`${controlClass}${options === null ? " animate-pulse" : ""}`}
      >
        <option value="">{copy.ordinaryTrip}</option>
        {options === null ? (
          <>
            {/* The catalogue is still in flight; the course this panel was
                opened for is the one option that must already be here. */}
            {initialCourse ? <option value={initialCourse.id}>{initialCourse.title}</option> : null}
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
  );
}

/** Repeat: the recurrence controls, hidden and disabled until "More options". */
export function RepeatGroup({
  copy,
  more,
  startDate,
  expanded,
}: {
  copy: BuilderCopy;
  more: BuilderMoreOptions;
  startDate: string;
  expanded: boolean;
}) {
  return (
    <>
      {/* A legend names this recurrence control group; it must remain a
        fieldset rather than becoming a generic SectionCard. */}
      <fieldset hidden={!expanded} disabled={!expanded} className={GROUP_FRAME}>
        <legend className={`${legendClass} text-sm font-medium`}>{copy.repeatLegend}</legend>
        <RepeatFields
          startDate={startDate}
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
    </>
  );
}

/** The weekday pattern's usual crew, as removable chips that post with the form. */
export function PatternCrew({
  copy,
  crew,
  setCrew,
  crewNames,
}: {
  copy: BuilderCopy;
  crew: { id: string; name: string }[];
  setCrew: (
    update: (current: { id: string; name: string }[]) => { id: string; name: string }[],
  ) => void;
  crewNames: string;
}) {
  if (crew.length === 0) return null;
  return (
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
  );
}

/** The pattern line: what the weekday's usual departure filled in, and the way back to a blank form. */
export function PatternNote({
  copy,
  pattern,
  weekdayNames,
  startBlank,
}: {
  copy: BuilderCopy;
  /** The applied pattern, or null when none was applied. */
  pattern: BuilderPattern | null;
  weekdayNames: readonly string[];
  startBlank: () => void;
}) {
  if (!pattern) return null;
  return (
    <p
      role="status"
      className={`flex flex-wrap items-center gap-x-1 gap-y-1 ${INSET_NOTE_BOX} bg-surface-sunken`}
    >
      <span>
        {fill(copy.patternFilled, {
          count: pattern.sampledDays,
          weekday: weekdayNames[pattern.weekday] ?? "",
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
  );
}

/**
 * The brief a request-led panel opens with: how many divers the requests
 * represent, the boat and crew that fits them, and each request as a ticked
 * box that posts with the departure.
 */
export function RequestPlanBrief({
  copy,
  requestPlan,
}: {
  copy: BuilderCopy;
  requestPlan: BuilderRequestPlan;
}) {
  return (
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
              name="interestId"
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
  );
}

/**
 * What kind of day this is: the dive mode (only when the shop offers more than
 * one), the hull (only with boats), and the shop's own trip tag (only with a
 * vocabulary). A single mode is submitted rather than asked.
 */
export function DayKindSelects({
  copy,
  options,
  offeredModes,
  diveMode,
  setDiveMode,
  selectedBoatId,
  setSelectedBoatId,
  setCapacity,
  lensId,
  setLensId,
}: {
  copy: BuilderCopy;
  options: BuilderOptions | null;
  offeredModes: readonly DiveMode[];
  diveMode: DiveMode;
  setDiveMode: (mode: DiveMode) => void;
  selectedBoatId: string;
  setSelectedBoatId: (id: string) => void;
  setCapacity: (capacity: number) => void;
  lensId: string;
  setLensId: (id: string) => void;
}) {
  return offeredModes.length > 1 ||
    (options?.boats && options.boats.length > 0) ||
    (options?.lenses && options.lenses.length > 0) ? (
    <FieldGrid columns={2} className="gap-y-4">
      {offeredModes.length > 1 ? (
        <Field label={copy.diveModeLabel}>
          <select
            name="diveMode"
            value={diveMode}
            onChange={(event) => setDiveMode(event.target.value as DiveMode)}
            className={controlClass}
          >
            {offeredModes.includes("boat") ? <option value="boat">{copy.modeBoat}</option> : null}
            {offeredModes.includes("shore") ? (
              <option value="shore">{copy.modeShore}</option>
            ) : null}
            {offeredModes.includes("pool") ? <option value="pool">{copy.modePool}</option> : null}
          </select>
        </Field>
      ) : (
        // One mode on offer is not a choice — it is submitted, not asked.
        <input type="hidden" name="diveMode" value={offeredModes[0] ?? "boat"} />
      )}
      {diveMode === "boat" && options?.boats && options.boats.length > 0 ? (
        <Field label={copy.boatSelectLabel} hint={copy.optional}>
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
            <option value="">{copy.unassignedBoat}</option>
            {options.boats.map((boat) => (
              <option key={boat.id} value={boat.id}>
                {boat.name} (
                {fill(
                  pluralForm(boat.capacity, {
                    one: copy.boatCapacityOne,
                    other: copy.boatCapacityOther,
                  }),
                  { capacity: boat.capacity },
                )}
                )
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
        <Field label={copy.lensLabel} hint={copy.optional}>
          <select
            name="lensId"
            value={lensId}
            onChange={(event) => {
              setLensId(event.target.value);
            }}
            className={controlClass}
          >
            <option value="">{copy.lensNone}</option>
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
  );
}

/**
 * The expanded-only description and the private mark, `hidden` and disabled
 * while collapsed so the quick payload stays exactly the quick one.
 */
export function DescriptionAndPrivacy({
  copy,
  expanded,
}: {
  copy: BuilderCopy;
  expanded: boolean;
}) {
  return (
    <>
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
      <ExpandedBox
        expanded={expanded}
        name="isPrivate"
        label={copy.isPrivateLabel}
        hint={copy.isPrivateHint}
      />
      <ExpandedBox
        expanded={expanded}
        name="isRehearsal"
        label={copy.isRehearsalLabel}
        hint={copy.isRehearsalHint}
      />
    </>
  );
}

/**
 * One of More options' boxes. The wrapper carries `hidden` and the box is
 * `disabled` while collapsed, so a collapsed form submits nothing from it.
 */
function ExpandedBox({
  expanded,
  name,
  label,
  hint,
}: {
  expanded: boolean;
  name: string;
  label: string;
  hint: string;
}) {
  return (
    <div className={expanded ? undefined : "hidden"}>
      <ChoiceRow
        type="checkbox"
        name={name}
        value="true"
        disabled={!expanded}
        className="text-sm font-medium"
      >
        <span className="block">{label}</span>
        <span className="block text-xs font-normal text-muted">{hint}</span>
      </ChoiceRow>
    </div>
  );
}

/** "More options" with what is behind it, then the panel's one submit and Cancel. */
export function PanelFooter({
  copy,
  expanded,
  toggleExpanded,
  onCancel,
}: {
  copy: BuilderCopy;
  expanded: boolean;
  toggleExpanded: () => void;
  onCancel: () => void;
}) {
  return (
    <>
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
    </>
  );
}

/** The passenger ceiling after crew places is advisory; it never disables the field. */
export function CapacityField({
  copy,
  capacity,
  boatCapacity,
  assignedCrewCount = 0,
  setCapacity,
}: {
  copy: BuilderCopy;
  capacity: number;
  boatCapacity?: number;
  assignedCrewCount?: number;
  setCapacity: (capacity: number) => void;
}) {
  const passengerLimit =
    boatCapacity === undefined ? undefined : Math.max(0, boatCapacity - assignedCrewCount);
  return (
    <Field
      label={copy.seats}
      description={
        passengerLimit !== undefined && capacity > passengerLimit
          ? fill(copy.boatCapacityWarning, { count: passengerLimit })
          : undefined
      }
    >
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
  );
}

/** The public price is optional, with a currency-shaped input. */
export function PriceInputGroup({
  copy,
  price,
  coursePriceLabel,
}: {
  copy: BuilderCopy;
  price: BuilderPriceInput;
  coursePriceLabel?: string | null;
}) {
  const hasCoursePrice = Boolean(coursePriceLabel);
  return (
    <FieldGrid columns={1}>
      <Field
        label={copy.price}
        hint={hasCoursePrice ? undefined : copy.optional}
        description={coursePriceLabel ?? copy.priceDescription}
      >
        <input
          name="priceDollars"
          type="number"
          step={price.step}
          min={0}
          max={price.max}
          placeholder={price.placeholder}
          hidden={hasCoursePrice}
          disabled={hasCoursePrice}
          className={`${controlClass} max-w-28 tabular-nums`}
        />
      </Field>
    </FieldGrid>
  );
}
