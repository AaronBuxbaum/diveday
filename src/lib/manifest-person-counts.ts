/** Physical people, independent of the passenger/crew roles they hold. */
export function physicalPeople(
  passengers: readonly {
    bookingId: string;
    personId?: string;
    identityWithheld?: boolean;
    identityClaim?: unknown;
    readiness?: { blockers: readonly { code: string }[] };
  }[],
  crew: readonly { id?: string }[],
): number {
  const people = new Set(
    crew.map((member, index) => (member.id ? `person:${member.id}` : `unknown-crew:${index}`)),
  );
  for (const passenger of passengers) {
    // Unconfirmed identities and older copies cannot establish an overlap.
    people.add(
      passenger.personId &&
        !passenger.identityWithheld &&
        passenger.identityClaim === undefined &&
        !passenger.readiness?.blockers.some((blocker) => blocker.code === "identity_unconfirmed")
        ? `person:${passenger.personId}`
        : `booking:${passenger.bookingId}`,
    );
  }
  return people.size;
}
