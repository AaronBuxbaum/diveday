/** Overlapping roles, within one departure; never reconciles conflicting evidence. */
export function closeoutRoleOverlap(
  passengers: readonly { personId: string; sailed: boolean; confirmed: boolean; back: boolean }[],
  crew: readonly { personId: string; ashore: boolean; back: boolean }[],
) {
  const out = new Set(
    passengers.filter((row) => row.sailed && row.confirmed).map((row) => row.personId),
  );
  const back = new Set(
    passengers.filter((row) => row.sailed && row.confirmed && row.back).map((row) => row.personId),
  );
  return {
    out: crew.filter((row) => !row.ashore && out.has(row.personId)).length,
    // Unknown or conflicting final evidence never establishes a shared return.
    back: crew.filter((row) => !row.ashore && row.back && back.has(row.personId)).length,
  };
}
