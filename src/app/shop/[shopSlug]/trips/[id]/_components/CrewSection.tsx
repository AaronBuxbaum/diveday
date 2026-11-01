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
 * Day-of crew editing for one trip. Assign/unassign writes are per-person
 * (`updateCrewAction`/`changeTripCrew`) so concurrent edits do not overwrite
 * another staff member's assignment.
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
   * Assigned people with a staff shift overlapping this trip, or `null` when
   * the shop has no shift schedule; null means no coverage badge is shown.
   * An empty array means scheduling exists and assigned crew are off shift.
   */
  onShiftIds: string[] | null;
  /**
   * Assigned people also scheduled on another overlapping departure
   * (`crewClashes`, `src/db/trips-crew.ts`). Show each conflict and the other
   * departure as information, not an extra gate; the owner remains responsible
   * for crew assignment.
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
    /* The About row is the disclosure control; this section uses its text as
       the accessible name and keeps the crew anchor clear of the sticky header. */
    <section id="crew" aria-label={copy.heading} className="flex flex-col gap-3 pt-1 scroll-mt-24">
      {/* Keep departure notes in the shared inset treatment. */}
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
        // Use the shared empty-section treatment inside the About card.
        <EmptyState title={copy.noStaff} nested />
      ) : (
        <div className="flex flex-col gap-3">
          {hasUnassignedStaff ? (
            // The placeholder is visible text; aria-label supplies the
            // accessible name. The wrapper controls responsive width.
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
            // Keep the shared empty-section grammar; this inline state needs
            // no icon and stays nested in the Crew card.
            <EmptyState title={copy.notAssignedYet} icon={false} nested />
          ) : (
            // The roster is inset within the Crew card.
            <ul className="divide-y divide-border rounded-inset bg-surface-sunken">
              {localCrew.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-medium">{entry.fullName}</span>
                      {/* The trip role is shown once; shift coverage is silent
                          when normal and remains available to screen readers. */}
                      {onShift === null ? null : onShift.has(entry.id) ? (
                        <span className="sr-only">{copy.onShift}</span>
                      ) : (
                        <Badge tone="warning" size="sm">
                          {copy.notOnShift}
                        </Badge>
                      )}
                    </span>
                    {/* A standing conflict is informational status, one per
                        other departure, keyed by id so equal titles remain distinct. */}
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
                    {/* This is the role for this departure; blank means
                        unspecified. See ADR 20260803-per-trip-crew-role. */}
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
                    {/* Keep the icon-only removal control at the shared
                        accessible tap-target size. */}
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
          {/* Shared status treatment covers assignment, removal, and role
              changes, and renders nothing when there is no refusal. */}
          <FormStatus tone="danger">
            {assignRefusal === null
              ? null
              : assignRefusal.code === "crew_clash"
                ? fill(copy.assignClash, { name: assignRefusal.name })
                : copy.assignFailed}
          </FormStatus>
        </div>
      )}
      {/* Shift management stays after the trip-specific crew information. */}
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
