"use client";

import Link from "next/link";
import { EmptyState } from "@/components/EmptyState";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { INSET_NOTE_BOX, INSET_NOTE_CLASS } from "@/components/ui/card";
import { controlClass, FormStatus } from "@/components/ui/form";
import type { TripCrewChange } from "@/db/trips";
import { fill } from "@/i18n/fill";
import { TRIP_CREW_ROLES, type TripCrewRole } from "@/lib/crew-roles";
import type { StaffList } from "./types";
import { useCrewRoster } from "./use-crew-roster";

export type CrewSectionCopy = {
  heading: string;
  /** Shown when the course has zero instructors assigned (`courseCrewGap` "no_instructor"). */
  courseNeedsInstructor: string;
  /** Pre-rendered — already carries the booked/capacity numbers — or null when the gap isn't `over_ratio`. */
  overRatioWarning: string | null;
  /**
   * The shop's own diver-to-divemaster target, pre-rendered with the numbers
   * in it, or null when this departure already meets it
   * (`src/lib/divemaster-ratio.ts`). Advice: it refuses nothing, which is why
   * it reads in the section's ordinary ink rather than the warning block the
   * two agency gates above it use.
   */
  underTargetNote: string | null;
  /**
   * Pre-rendered, or null when every booked diver who signalled a language
   * preference is covered by the assigned crew's recorded languages — same
   * tone and reasoning as `underTargetNote` (issue #708).
   */
  languageGapNote: string | null;
  /**
   * Pre-rendered with the names in it, or null when no rostered professional's
   * recorded rating lapses before this departure (issue #1853). It is why the
   * gap above can fire on a crew list that names an instructor; said in the
   * section's ordinary ink because the gap itself already carries the warning.
   */
  ratingLapsedNote: string | null;
  /** No staff exist in the shop at all yet, so there's nobody to assign. */
  noStaff: string;
  /** Staff exist, but nobody is on this trip's crew yet. */
  notAssignedYet: string;
  assignLabel: string;
  assignOption: string;
  /** `{name}` placeholder, filled per crew member client-side. */
  unassignAria: string;
  assignFailed: string;
  /**
   * The one refusal with a reason worth reading: the person just picked is
   * already crewing another departure at these hours, so `changeTripCrew`
   * turned the assignment down (`crew_clash`, src/db/trips-crew.ts). `{name}`
   * — the panel knows who was picked; it does not know which other boat,
   * because the write reports the impossibility rather than its counterpart.
   *
   * It exists because `assignFailed` was reaching this case: the panel that
   * explains a standing clash in exact words told the staffer who tried to
   * *create* one to check their connection, and the next move at a dock is to
   * tap again or to go and widen the other departure's hours until it sticks
   * — which manufactures the very state the mark below reports.
   */
  assignClash: string;
  /**
   * `{departure}` — the other boat this person is on at the same hours (issue
   * #1695). It sits in their own row, so it names the departure and not them.
   */
  clash: string;
  onShift: string;
  notOnShift: string;
  /** Null when the shop keeps no crew schedule, so there is no week to go to. */
  manageShifts: string | null;
  /** The per-trip role picker: its `{name}` aria template, its "not specified" option, and each job. */
  roleAria: string;
  roleUnspecified: string;
  roleOptions: Record<TripCrewRole, string>;
};

/**
 * Day-of crew editing for one trip. Assign/unassign is per-person
 * (`updateCrewAction`, the same `changeTripCrew` mutation the schedule board
 * uses) rather than replacing the whole assigned set, so two
 * staff editing this trip and the board at once can no longer silently clobber
 * each other's change (docs/product/archive/ux-personas-20260730-findings.md, Lens
 * 17 task 139).
 */
export function CrewSection({
  tripId,
  staff,
  crewIds,
  crewRoles,
  onShiftIds,
  clashes = [],
  crewGapCode,
  bookingInstructorPresent = false,
  shopSlug,
  updateCrewAction,
  copy,
}: {
  tripId: string;
  staff: StaffList;
  crewIds: string[];
  /** Each assigned person's current `trip_assignments.trip_role`, or null. */
  crewRoles: Record<string, TripCrewRole | null>;
  /**
   * Person ids among `crewIds` who have a staff shift overlapping this trip's
   * window — or `null` when the shop has never scheduled a shift, in which
   * case no coverage state renders at all: "Not on a shift" is a warning for
   * shops whose own schedule says this sailing has a hole, not a permanent
   * amber pill for shops that don't keep one (design principle 9).
   */
  onShiftIds: string[] | null;
  /**
   * Crew on this departure who are also on another one whose hours overlap it
   * (`crewClashes`, src/db/trips-crew.ts). A physical impossibility the roster
   * refuses to *write* and which three writes that move the boat manufacture
   * anyway — a move, the Details form directly above this panel, and
   * reinstating a called-off departure; `crewClashes` names all three. Until
   * issue #1695 the schedule board's Move panel was the one surface that ever
   * said so, and it closed the moment the move went through.
   *
   * **Information, never a gate.** The owner assigns crew (issue #1345), so
   * nothing here refuses anything; the row is marked and the fix is theirs.
   */
  clashes?: readonly { personId: string; otherTripId: string; otherTitle: string }[];
  crewGapCode: "none" | "no_instructor" | "over_ratio";
  /** The separate roster claim used by the booking gate. */
  bookingInstructorPresent?: boolean;
  shopSlug: string;
  /**
   * `refusal` is the reason the write gives when it turned the change down
   * (`TripCrewOutcome`, src/db/trips-crew.ts). Optional, so an action that has
   * nothing to say still satisfies this and reaches `assignFailed` — the
   * sentence every other `false` has always had.
   */
  updateCrewAction: (
    tripId: string,
    change: TripCrewChange,
  ) => Promise<{ ok: boolean; refusal?: "crew_clash" | "refused" }>;
  copy: CrewSectionCopy;
}) {
  const {
    availableStaff,
    localCrew,
    localRoles,
    assignRefusal,
    hydrated,
    handleAssign,
    handleRole,
    handleUnassign,
  } = useCrewRoster({ tripId, staff, crewIds, crewRoles, updateCrewAction });
  const onShift = onShiftIds === null ? null : new Set(onShiftIds);
  const hasUnassignedStaff = localCrew.length < availableStaff.length;

  return (
    /* The About row above is the heading and the disclosure control, so this
       renders no heading of its own — `copy.heading` is the region's accessible
       name instead (`TripAboutSection`, design review 2026-09-17).

       Still `id="crew"`, and still `scroll-mt-24`: the shop header is sticky,
       so anything shallower parks the anchor underneath it, and the pulse's
       "needs an instructor" fact links straight here. */
    <section id="crew" aria-label={copy.heading} className="flex flex-col gap-3 pt-1 scroll-mt-24">
      {/* The departure's inset notes, one box whether warning or advice
          (`INSET_NOTE_BOX`): they were 16px in where the requirements and
          roster notes beside them are 12px. */}
      {crewGapCode === "no_instructor" && !bookingInstructorPresent ? (
        <p className={`${INSET_NOTE_BOX} bg-warning-tint font-medium text-warning-strong`}>
          {copy.courseNeedsInstructor}
        </p>
      ) : null}
      {crewGapCode === "over_ratio" && copy.overRatioWarning ? (
        <p className={`${INSET_NOTE_BOX} bg-warning-tint font-medium text-warning-strong`}>
          {copy.overRatioWarning}
        </p>
      ) : null}
      {copy.ratingLapsedNote ? <p className={INSET_NOTE_CLASS}>{copy.ratingLapsedNote}</p> : null}
      {copy.underTargetNote ? <p className={INSET_NOTE_CLASS}>{copy.underTargetNote}</p> : null}
      {copy.languageGapNote ? <p className={INSET_NOTE_CLASS}>{copy.languageGapNote}</p> : null}

      {staff.length === 0 ? (
        // The shared empty-section grammar, not a bare paragraph
        // (design/principles.md #4). `nested`: this sits in the About card
        // too, and its own bed shadow would fall on the card's white.
        <EmptyState title={copy.noStaff} nested />
      ) : (
        <div className="flex flex-col gap-3">
          {hasUnassignedStaff ? (
            // The select's own placeholder option already says "Assign crew…",
            // so a visible caption beside it said the same thing twice
            // (design/principles.md #9) — the aria-label keeps the accessible
            // name the specs and screen readers address it by.
            // Sized by the wrapper, not by width classes appended to
            // `controlClass` — that string already carries `w-full`, and two
            // width utilities resolve by stylesheet order rather than class
            // order (same trap as `min-h-*`, see components/ui/button.ts). Full
            // width on a phone, shrink-to-content from `sm` up, which is what
            // the hand-rolled `sm:w-auto` on the select used to buy.
            <div className="sm:w-fit">
              <select
                aria-label={copy.assignLabel}
                defaultValue=""
                data-hydrated={hydrated ? "true" : "false"}
                onChange={(event) => {
                  const personId = event.currentTarget.value;
                  event.currentTarget.value = "";
                  void handleAssign(personId);
                }}
                className={controlClass}
              >
                <option value="">{copy.assignOption}</option>
                {availableStaff
                  .filter((entry) => !localCrew.some((crew) => crew.id === entry.id))
                  .map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.fullName}
                    </option>
                  ))}
              </select>
            </div>
          ) : null}

          {localCrew.length === 0 ? (
            // The same empty-section grammar this file already uses for the
            // no-staff-at-all case 30 lines up (design/principles.md, "Empty
            // states follow one rule") — it was a bare `<p>`, so one component
            // said "nothing here" two ways. `icon={false}`: this one sits under
            // the assign picker rather than standing alone, so the bubbles
            // would outweigh the line of text. `nested`: it sits in the Crew
            // card, whose white it would otherwise shadow.
            <EmptyState title={copy.notAssignedYet} icon={false} nested />
          ) : (
            // A sunken inset, not a card in a card — the roster is carved into
            // the Crew card the way ShopStat's `inset` variant is (see
            // SectionCard's "what is not a section card").
            <ul className="divide-y divide-border rounded-inset bg-surface-sunken">
              {localCrew.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-medium">{entry.fullName}</span>
                      {/* No shop-role echo beside the name: the trip-role select
                        on the same row is the operative fact once someone is
                        aboard, and "divemaster … [Divemaster ▾]" said it twice
                        (principle 9). The assign menu lists bare names, the
                        same grammar as Today's departure board. */}
                      {/* Badge only for the exceptional state: at a shop that
                        schedules shifts, a normal day has every crew member on
                        one, and a green pill per row is the expected state
                        formatted as an alert (design/principles.md #9). A row
                        with no badge is covered; the sr-only text keeps that
                        fact audible. At a shop with no shift schedule at all
                        (`onShift === null`) the question doesn't apply and
                        nothing renders — see `onShiftIds` above. */}
                      {onShift === null ? null : onShift.has(entry.id) ? (
                        <span className="sr-only">{copy.onShift}</span>
                      ) : (
                        <Badge tone="warning" size="sm">
                          {copy.notOnShift}
                        </Badge>
                      )}
                    </span>
                    {/* **The clash the panel used to say nothing about** (issue
                        #1695). Not a badge: it names the other boat, which is
                        the question the reader has the moment they see it, and
                        a pill that long is a paragraph in a pill. Warning ink
                        and the glyph, as the staffing week draws the same fact.
                        A gate is what #1345 decided against: the owner assigns
                        crew.

                        **`role="status"`, not `alert`** (dive-domain-expert
                        review, 2026-09-12). This line is statically rendered
                        with the page: on a cold load a live region that is
                        already present at first paint has no change to
                        announce, and on a soft navigation into the trip it
                        interrupts — so `alert` made the announcement a coin
                        flip on how the reader arrived, at the volume reserved
                        for something that just happened. A standing condition
                        is `status` at most, and its real weight comes from
                        where it is drawn: the About summary row carries the
                        mark, because this panel sits inside a `<details>` that
                        is closed on an ordinary visit, and nothing inside a
                        closed disclosure is in the accessibility tree at all.
                        One per clash rather than one wrapping the roster, so
                        two clashing divemasters are two facts.

                        Keyed on the other departure's **id**, never its title —
                        two boats can be called the same thing, and the reader
                        loses one of them silently (the reason `crewClashes`
                        dedupes on ids too). */}
                    {clashes
                      .filter((clash) => clash.personId === entry.id)
                      .map((clash) => (
                        <span
                          key={clash.otherTripId}
                          role="status"
                          className="flex items-start gap-1 font-medium text-warning-strong"
                        >
                          <DiveDayIcon name="warning" className="mt-0.5 size-3.5 shrink-0" />
                          <span>{fill(copy.clash, { departure: clash.otherTitle })}</span>
                        </span>
                      ))}
                  </span>
                  <span className="flex items-center gap-2">
                    {/* The job on *this* sailing (ADR 20260803-per-trip-crew-role).
                        Until this existed nothing in the app could write the
                        field, so the divemaster-rostered-as-captain over-count
                        it fixes was live at every shop (review 20260803, D5).
                        Unspecified stays the honest default — it means nobody
                        has said, and it counts exactly as it always did. */}
                    {/* Sized by the wrapper, not by a width class appended to
                        `controlClass` — that string already carries `w-full`,
                        and two width utilities resolve by stylesheet order
                        rather than class order (same trap as `min-h-*`, see
                        components/ui/button.ts). */}
                    <span className="w-44 shrink-0">
                      <select
                        aria-label={fill(copy.roleAria, { name: entry.fullName })}
                        value={localRoles[entry.id] ?? ""}
                        onChange={(event) => {
                          const next = event.currentTarget.value;
                          void handleRole(entry.id, next === "" ? null : (next as TripCrewRole));
                        }}
                        // `md`, the height of the `icon` remove square beside
                        // it: a row with a text control in it is an `md` row.
                        className={controlClass}
                      >
                        <option value="">{copy.roleUnspecified}</option>
                        {TRIP_CREW_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {copy.roleOptions[role]}
                          </option>
                        ))}
                      </select>
                    </span>
                    {/* A square 48px target holding one glyph: 44px tall but
                        ~24px wide was a sliver of a target for a dockside tap
                        that drops a crew member (design/principles.md #2). The
                        box is `size: "icon"` rather than a hand-spelled
                        `min-h-11 min-w-11` — that spelling was one of the four
                        this app drifted into before the size existed (see
                        components/ui/button.ts). */}
                    <button
                      type="button"
                      onClick={() => handleUnassign(entry.id)}
                      className={buttonClass({ variant: "danger-ghost", size: "icon" })}
                      aria-label={fill(copy.unassignAria, { name: entry.fullName })}
                    >
                      <DiveDayIcon name="close" className="size-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* `FormStatus`, not a hand-rolled `role="alert"` paragraph: it is
              the shared shape for "this control's own attempt was refused"
              (docs/design/forms-and-controls.md), and it carries the drawn
              danger mark this was missing — without one the refusal reached a
              colourblind reader as ordinary small text (design/principles.md #6). It sits
              at the foot of the block rather than beside one control because
              any of the three writes here — assign, unassign, change the job —
              can raise it. Renders nothing when there is nothing to say. */}
          <FormStatus tone="danger">
            {assignRefusal === null
              ? null
              : assignRefusal.code === "crew_clash"
                ? fill(copy.assignClash, { name: assignRefusal.name })
                : copy.assignFailed}
          </FormStatus>
        </div>
      )}
      {/* The door out, at the end rather than over the warnings: who is on
          shift this week is a different subject, and a staffer reaches for it
          after reading this departure's crew rather than instead of it
          (principles.md §10, "actions ride on their objects"). It wears
          `buttonClass` for the 44px floor the header slot used to give it,
          and `self-start` so the column does not stretch its centred box to
          the panel's width and float the words mid-panel. */}
      {copy.manageShifts === null ? null : (
        <Link
          href={`/shop/${shopSlug}/staffing`}
          className={buttonClass({
            variant: "link",
            size: "sm",
            flush: true,
            className: "self-start",
          })}
        >
          {copy.manageShifts}
        </Link>
      )}
    </section>
  );
}
