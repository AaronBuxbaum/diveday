/**
 * **The two fields `PaperWaiverControl` submits for a minor**, read back
 * (ADR 20260907-guardian-co-signature).
 *
 * Three staff surfaces open the same paper-release form — the trip roster, the
 * counter queue and the diver's own record — and all three hand what comes
 * back to `recordInPersonWaiver`. Reading the pair in one place is what keeps
 * the three doors onto one write path from drifting into three parsers, in the
 * same spirit as `src/app/actions/seat-diver-surfaces.ts`.
 *
 * Nothing is validated here. `recordInPersonWaiver` decides from the date of
 * birth on file whether a guardian is needed at all, refuses a relationship
 * that is not one of the codes, and refuses a name that is the diver's own —
 * so a value invented by a hand-built request never reaches a record. Returns
 * `undefined` when the form carried no guardian section, which is every adult.
 */
export function paperGuardianFrom(
  formData: FormData,
): { name: string; relationship: string } | undefined {
  const name = formData.get("guardianName");
  const relationship = formData.get("guardianRelationship");
  if (typeof name !== "string" || typeof relationship !== "string") return undefined;
  if (!name.trim() || !relationship.trim()) return undefined;
  return { name, relationship };
}
