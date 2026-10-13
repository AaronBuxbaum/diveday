import { unstable_rethrow } from "next/navigation";
import { useEffect, useState } from "react";
import type { TripCrewChange } from "@/db/trips";
import type { TripCrewRole } from "@/lib/crew-roles";
import type { StaffList } from "./types";

/**
 * **This departure's crew as the panel holds it**, and the three writes that
 * change it: assign, set the job on this sailing, unassign. Every write is
 * confirm-then-render, and a refusal is held as a code with the name it was
 * about, for `CrewSection`'s one status line.
 */
export function useCrewRoster({
  tripId,
  staff,
  crewIds,
  crewRoles,
  updateCrewAction,
}: {
  tripId: string;
  staff: StaffList;
  crewIds: string[];
  crewRoles: Record<string, TripCrewRole | null>;
  updateCrewAction: (
    tripId: string,
    change: TripCrewChange,
  ) => Promise<{ ok: boolean; refusal?: "crew_clash" | "refused" }>;
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
      // same shape `scripts/lint-rules/redirectInTry.grit` refuses on the server.
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

  return {
    availableStaff,
    localCrew,
    localRoles,
    assignRefusal,
    hydrated,
    handleAssign,
    handleRole,
    handleUnassign,
  };
}
