/**
 * **A paper release as the counter writes it** (issue #2684): the fields a
 * seeded signed waiver shares, so no seed names the method itself. The method
 * is `in_person_attested` and a named staffer recorded it, exactly what
 * `recordInPersonWaiver` stores; the older seeds' own value for it was one no
 * shop could produce.
 */
export function paperRelease(signedAt: Date, recordedByPersonId: string) {
  return {
    status: "completed" as const,
    signedName: "Signed on file",
    signatureMethod: "in_person_attested" as const,
    recordedByPersonId,
    consentedAt: signedAt,
    signedAt,
    completedAt: signedAt,
  };
}
