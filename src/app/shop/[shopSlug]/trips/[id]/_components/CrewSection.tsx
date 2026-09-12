"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, FormStatus } from "@/components/ui/form";
import type { TripCrewChange } from "@/db/trips";
import { fill } from "@/i18n/fill";
import { TRIP_CREW_ROLES, type TripCrewRole } from "@/lib/crew-roles";
import type { StaffList } from "./types";

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
  manageShifts: string;
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
  shopSlug,
  updateCrewAction,
  copy,
  embedded = false,
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
  /** The Trip surface's About panel supplies the outer section chrome. */
  embedded?: boolean;
}) {
  const availableStaff = staff.map((entry) => ({
    id: entry.person.id,
    fullName: entry.person.fullName,
    roles: entry.roles,
  }));
  const crewFromProps = availableStaff.filter((entry) => crewIds.includes(entry.id));
  const [localCrew, setLocalCrew] = useState(crewFromProps);
  const [localRoles, setLocalRoles] = useState(crewRoles);
  /**
   * The refusal on screen, with the person it was about — `null` when the last
   * write stood.
   *
   * A code rather than a sentence, resolved once at the foot of the block: the
   * three writes here share one status line, and two of them can be turned
   * down for a reason a staffer would act on differently (`crew_clash`, issue
   * #1695). The name travels with it because the panel is the one thing that
   * knows who was picked — the write reports the impossibility, not who it
   * happened to.
   */
  const [assignRefusal, setAssignRefusal] = useState<{
    code: "crew_clash" | "refused";
    name: string;
  } | null>(null);
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
    setAssignRefusal(null);
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
    setAssignRefusal(null);
    try {
      const res = await updateCrewAction(tripId, { personId, operation: "assign" });
      if (res.ok) {
        setLocalCrew([...localCrew, person]);
      } else {
        // **The refusal says which refusal it was** (issue #1695). A crew
        // clash is the one reason here whose fix is not "tap it again": this
        // person is on another boat at these very hours, which is the same
        // impossibility the rows above report for a departure already standing
        // in it. Anything else — the course's instructor rule, roll-call
        // history, a person who is not staff — keeps the sentence it has
        // always had.
        setAssignRefusal({
          code: res.refusal === "crew_clash" ? "crew_clash" : "refused",
          name: person.fullName,
        });
      }
    } catch (error) {
      // **The refusal is not a failure.** `updateTripCrewAction` opens with
      // `requireShopSurface`, whose contract is that *every* refusal throws — a
      // cross-shop slug is `notFound()`, a failed permission gate is
      // `redirect()` — and those sentinels reach this catch on the client too.
      // Swallowing one turned a refusal into "That didn't save", so the
      // navigation happened *and* the row claimed a transport error. Measured
      // on the check-in queue's twin of this catch (issue #819); this is the
      // same shape `scripts/check-redirect-in-try.mjs` refuses on the server.
      unstable_rethrow(error);
      setAssignRefusal({ code: "refused", name: person.fullName });
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
    const name = localCrew.find((entry) => entry.id === personId)?.fullName ?? "";
    setAssignRefusal(null);
    try {
      const res = await updateCrewAction(tripId, { personId, operation: "assign", tripRole });
      if (res.ok) {
        setLocalRoles({ ...localRoles, [personId]: tripRole });
      } else {
        // A role change is an `assign` on the same mutation, so it meets the
        // same conflict check — which means somebody already standing in a
        // clash cannot have their job on this sailing set until it is
        // resolved. That is worth saying in those words rather than as a
        // connection error.
        setAssignRefusal({ code: res.refusal === "crew_clash" ? "crew_clash" : "refused", name });
      }
    } catch (error) {
      // The refusal is not a failure — see the catch above.
      unstable_rethrow(error);
      setAssignRefusal({ code: "refused", name });
    }
  };

  const handleUnassign = async (personId: string) => {
    const name = localCrew.find((entry) => entry.id === personId)?.fullName ?? "";
    setAssignRefusal(null);
    try {
      const res = await updateCrewAction(tripId, { personId, operation: "unassign" });
      if (res.ok) {
        setLocalCrew(localCrew.filter((entry) => entry.id !== personId));
      } else {
        // Taking somebody off a boat cannot clash with anything — the write
        // runs no conflict check on an unassign — so this one keeps the
        // general sentence whatever the outcome carries.
        setAssignRefusal({ code: "refused", name });
      }
    } catch (error) {
      // The refusal is not a failure — see the catch above.
      unstable_rethrow(error);
      setAssignRefusal({ code: "refused", name });
    }
  };

  return (
    <SectionCard
      id="crew"
      padding={embedded ? "none" : "lg"}
      title={copy.heading}
      // `scroll-mt-24`, the family convention (DetailsSection, RosterSection):
      // the shop header is sticky, so anything shallower parks an anchored
      // heading underneath it — and the pulse's "needs an instructor" fact
      // links straight to #crew.
      className={`${embedded ? "!rounded-none !border-0 !bg-transparent" : ""} scroll-mt-24`}
      actions={
        <Link
          href={`/shop/${shopSlug}/staffing`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {copy.manageShifts}
        </Link>
      }
    >
      {crewGapCode === "no_instructor" ? (
        <p className="mb-3 rounded-lg bg-warning-tint px-4 py-3 text-sm font-medium text-warning-strong">
          {copy.courseNeedsInstructor}
        </p>
      ) : null}
      {crewGapCode === "over_ratio" && copy.overRatioWarning ? (
        <p className="mb-3 rounded-lg bg-warning-tint px-4 py-3 text-sm font-medium text-warning-strong">
          {copy.overRatioWarning}
        </p>
      ) : null}
      {copy.underTargetNote ? (
        <p className="mb-3 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-muted">
          {copy.underTargetNote}
        </p>
      ) : null}
      {copy.languageGapNote ? (
        <p className="mb-3 rounded-lg bg-surface-sunken px-4 py-3 text-sm text-muted">
          {copy.languageGapNote}
        </p>
      ) : null}

      {staff.length === 0 ? (
        // The shared empty-section grammar, not a bare paragraph
        // (design/principles.md #4).
        <EmptyState title={copy.noStaff} />
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
            <EmptyState title={copy.notAssignedYet} icon={false} />
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
                  <span className="flex flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
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
    </SectionCard>
  );
}
