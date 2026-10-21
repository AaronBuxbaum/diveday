import type { ManifestCrewMember, RollCallRecord } from "./manifests";

export const boardedAt = (recordedByName = "Dana Reyes"): RollCallRecord => ({
  state: "boarded",
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName,
});
/**
 * The recorder's name is the discriminator here. It used to be the note, which
 * went with the roll-call note itself (#1058) -- these tests only ever needed
 * *some* field that tells one record from another when several are in flight.
 */
export const notBoardedAt = (recordedByName = "Dana Reyes"): RollCallRecord => ({
  state: "not_boarded",
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName,
});

/**
 * A crew member with no emergency contact on file — the ordinary state, since
 * nobody is asked for one at hire. Tests that care about the contact pass it
 * explicitly; everything else says nothing and gets the common case.
 */
export const crewMember = (
  member: Omit<
    ManifestCrewMember,
    "emergencyContactName" | "emergencyContactPhone" | "standingRatings"
  > &
    Partial<
      Pick<ManifestCrewMember, "emergencyContactName" | "emergencyContactPhone" | "standingRatings">
    >,
): ManifestCrewMember => ({
  emergencyContactName: null,
  emergencyContactPhone: null,
  standingRatings: [],
  ...member,
});

export const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  endsAt: new Date("2026-07-20T16:00:00.000Z"),
  plannedDives: 2,
};
