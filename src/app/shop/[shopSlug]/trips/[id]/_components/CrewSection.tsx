"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { controlClass, FormStatus } from "@/components/ui/form";
import type { TripCrewChange } from "@/db/trips";
import { fill } from "@/i18n/fill";
import { TRIP_CREW_ROLES, type TripCrewRole } from "@/lib/crew-roles";
import type { StaffList } from "./types";

export type CrewSectionCopy = {
  heading: string;
  description: string;
  /** Shown when the course has zero instructors assigned (`courseCrewGap` "no_instructor"). */
  courseNeedsInstructor: string;
  /** Pre-rendered — already carries the booked/capacity numbers — or null when the gap isn't `over_ratio`. */
  overRatioWarning: string | null;
  /** No staff exist in the shop at all yet, so there's nobody to assign. */
  noStaff: string;
  /** Staff exist, but nobody is on this trip's crew yet. */
  notAssignedYet: string;
  assignLabel: string;
  assignOption: string;
  /** `{name}` placeholder, filled per crew member client-side. */
  unassignAria: string;
  assignFailed: string;
  onShift: string;
  notOnShift: string;
  manageShifts: string;
  /** The per-trip role picker: its `{name}` aria template, its "not specified" option, and each job. */
  roleAria: string;
  roleUnspecified: string;
  roleOptions: Record<TripCrewRole, string>;
};

/**
 * Day-of crew editing for one trip. Assign/unassign is per-person
 * (`updateCrewAction`, the same `changeTripCrew` mutation Today's
 * `DepartureBoard` uses) rather than replacing the whole assigned set, so two
 * staff editing this trip and Today at once can no longer silently clobber
 * each other's change (docs/product/archive/ux-personas-20260730-findings.md, Lens
 * 17 task 139).
 */
export function CrewSection({
  tripId,
  staff,
  crewIds,
  crewRoles,
  onShiftIds,
  crewGapCode,
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
  crewGapCode: "none" | "no_instructor" | "over_ratio";
  shopSlug: string;
  updateCrewAction: (tripId: string, change: TripCrewChange) => Promise<{ ok: boolean }>;
  copy: CrewSectionCopy;
}) {
  const availableStaff = staff.map((entry) => ({
    id: entry.person.id,
    fullName: entry.person.fullName,
    roles: entry.roles,
  }));
  const crewFromProps = availableStaff.filter((entry) => crewIds.includes(entry.id));
  const [localCrew, setLocalCrew] = useState(crewFromProps);
  const [localRoles, setLocalRoles] = useState(crewRoles);
  const [assignError, setAssignError] = useState(false);
  // Same affordance as BookingPartyFields: every control here is wired through
  // React handlers, so a pick made before hydration silently does nothing (the
  // DOM value changes, no action fires). Tests wait for this attribute before
  // interacting; real users are slower than hydration in practice.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Resyncs from the server's crewIds/staff, not from crewFromProps (a new
  // array every render). `assignError` rides along on the same dependency
  // array: this section is rendered once per trip id with no dynamic key of
  // its own, so if `cacheComponents: true`'s Activity-based navigation is
  // ever re-enabled, a stale error banner from Trip A's crew section could
  // otherwise survive a navigate-away-and-back into Trip B's (docs ADR
  // 20260801-cache-components-activity-state, currently reverted, commit
  // 100fcf8) — clearing it whenever the server's own crew data changes keeps
  // it scoped to the trip it was raised for.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resyncs from the server's crewIds/staff, not from crewFromProps (a new array every render).
  useEffect(() => {
    setLocalCrew(availableStaff.filter((entry) => crewIds.includes(entry.id)));
    setLocalRoles(crewRoles);
    setAssignError(false);
  }, [crewIds, crewRoles, staff]);

  const onShift = onShiftIds === null ? null : new Set(onShiftIds);
  const hasUnassignedStaff = localCrew.length < availableStaff.length;

  // Confirm-then-render, not optimistic-then-rollback: a staffer (or a test)
  // who sees "Unassign X" and immediately relies on the crew being staffed —
  // switching to Guests to add a course diver, which re-checks the
  // instructor requirement server-side — must never be able to outrun the
  // actual write. An optimistic update here raced exactly that: the local
  // state (and the "Unassign" button) updated before `updateCrewAction`'s
  // server round trip had committed, a window narrow enough to be
  // practically invisible under pre-cacheComponents dynamic rendering but
  // wide enough to be hit reliably once Partial Prerendering made the
  // following navigation faster (caught by e2e/gear-fit-and-age.spec.ts).
  const handleAssign = async (personId: string) => {
    const person = availableStaff.find((entry) => entry.id === personId);
    if (!person || localCrew.some((entry) => entry.id === personId)) return;
    setAssignError(false);
    try {
      const res = await updateCrewAction(tripId, { personId, operation: "assign" });
      if (res.ok) {
        setLocalCrew([...localCrew, person]);
      } else {
        setAssignError(true);
      }
    } catch {
      setAssignError(true);
    }
  };

  /**
   * Set (or clear) the job this person is doing on **this** sailing.
   *
   * `assign` is the idempotent upsert for someone already on the crew
   * (`changeTripCrew`), so the role change is one call on the same mutation the
   * rest of this section uses — no second action, no second write path. Same
   * confirm-then-render discipline as assign/unassign: the supervision ratio
   * reads this field, so the control must never show a role the server has not
   * accepted.
   */
  const handleRole = async (personId: string, tripRole: TripCrewRole | null) => {
    setAssignError(false);
    try {
      const res = await updateCrewAction(tripId, { personId, operation: "assign", tripRole });
      if (res.ok) {
        setLocalRoles({ ...localRoles, [personId]: tripRole });
      } else {
        setAssignError(true);
      }
    } catch {
      setAssignError(true);
    }
  };

  const handleUnassign = async (personId: string) => {
    setAssignError(false);
    try {
      const res = await updateCrewAction(tripId, { personId, operation: "unassign" });
      if (res.ok) {
        setLocalCrew(localCrew.filter((entry) => entry.id !== personId));
      } else {
        setAssignError(true);
      }
    } catch {
      setAssignError(true);
    }
  };

  return (
    <section id="crew" className="mt-10 scroll-mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{copy.heading}</h2>
          <p className="mt-1 text-sm text-muted">{copy.description}</p>
        </div>
        <Link
          href={`/shop/${shopSlug}/staffing`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {copy.manageShifts}
        </Link>
      </div>

      {crewGapCode === "no_instructor" ? (
        <p className="mt-3 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning-strong">
          {copy.courseNeedsInstructor}
        </p>
      ) : null}
      {crewGapCode === "over_ratio" && copy.overRatioWarning ? (
        <p className="mt-3 rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning-strong">
          {copy.overRatioWarning}
        </p>
      ) : null}

      {staff.length === 0 ? (
        // The shared empty-section grammar, not a bare paragraph
        // (design/principles.md #4).
        <EmptyState className="mt-4">
          <p className="text-sm text-muted">{copy.noStaff}</p>
        </EmptyState>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
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
                className={`${controlClass} text-sm`}
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
            // would outweigh the line of text.
            <EmptyState icon={false}>
              <p className="text-sm text-muted">{copy.notAssignedYet}</p>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {localCrew.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{entry.fullName}</span>
                    <span className="text-muted">{entry.roles.join(", ")}</span>
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
                        className={`${controlClass} text-sm`}
                      >
                        <option value="">{copy.roleUnspecified}</option>
                        {TRIP_CREW_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {copy.roleOptions[role]}
                          </option>
                        ))}
                      </select>
                    </span>
                    {/* A square 44px target holding one glyph: 44px tall but
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
                      ×
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* `FormStatus`, not a hand-rolled `role="alert"` paragraph: it is
              the shared shape for "this control's own attempt was refused"
              (docs/design/forms-and-controls.md), and it carries the ❌ glyph
              this was missing — without one the refusal reached a colourblind
              reader as ordinary small text (design/principles.md #6). It sits
              at the foot of the block rather than beside one control because
              any of the three writes here — assign, unassign, change the job —
              can raise it. Renders nothing when there is nothing to say. */}
          <FormStatus tone="danger">{assignError ? copy.assignFailed : null}</FormStatus>
        </div>
      )}
    </section>
  );
}
