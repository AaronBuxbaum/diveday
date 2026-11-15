/** A departure is covered only when there is no gap in its working time. */
export function shiftsCoverWindow(
  shifts: readonly { startsAt: Date; endsAt: Date }[],
  window: { startsAt: Date; endsAt: Date },
): boolean {
  let through = window.startsAt.getTime();
  const end = window.endsAt.getTime();
  if (end <= through) return false;
  for (const shift of [...shifts].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    if (shift.startsAt.getTime() > through) return false;
    through = Math.max(through, shift.endsAt.getTime());
    if (through >= end) return true;
  }
  return false;
}
