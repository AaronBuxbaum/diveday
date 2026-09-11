/**
 * **The fields `PaperWaiverControl` submits for a minor**, read back
 * (ADR 20260907-guardian-co-signature).
 *
 * Three staff surfaces open the same paper-release form — the trip roster, the
 * counter queue and the diver's own record — and all three hand what comes
 * back to `recordInPersonWaiver`. Reading them in one place is what keeps
 * the three doors onto one write path from drifting into three parsers, in the
 * same spirit as `src/app/actions/seat-diver-surfaces.ts`.
 *
 * Nothing is validated here. `recordInPersonWaiver` decides from the date of
 * birth on file whether a guardian is needed at all, refuses a relationship
 * that is not one of the codes, and refuses a name that is the diver's own
 * unless the namesake confirmation came with it — so a value invented by a
 * hand-built request never reaches a record. Returns `undefined` when the form
 * carried no guardian section, which is every adult.
 *
 * `guardianNamesakeAttested` is the staffer's own assertion that this parent
 * and this diver really do share a name on their IDs and that they watched
 * both of them sign (issue #1573). Read here because all three surfaces submit
 * it; honoured by the writer only when the two names actually match, and never
 * offered on the online path at all.
 */
export function paperGuardianFrom(
  formData: FormData,
): { name: string; relationship: string; namesakeAttested: boolean } | undefined {
  const name = formData.get("guardianName");
  const relationship = formData.get("guardianRelationship");
  if (typeof name !== "string" || typeof relationship !== "string") return undefined;
  if (!name.trim() || !relationship.trim()) return undefined;
  return {
    name,
    relationship,
    namesakeAttested: formData.get("guardianNamesakeAttested") === "on",
  };
}
