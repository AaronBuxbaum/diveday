/**
 * **Whether the dock-rider form shows** (D6): at the departure checkpoint
 * only, until the clock or the crew says the boat has left, and never on a
 * cancelled departure (#2394), where the server would only refuse the seat
 * after the captain had filled the form in.
 */
export function dockRiderDoorOpen({
  isDeparture,
  sailed,
  stage,
  cancelled,
}: {
  isDeparture: boolean;
  sailed: boolean;
  stage: { stage: string } | null;
  cancelled: boolean;
}): boolean {
  if (cancelled || !isDeparture || sailed) return false;
  return !stage || stage.stage === "boarding";
}
