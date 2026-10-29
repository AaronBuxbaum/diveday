/** The ISO-8601 week containing an instant, calculated against UTC. */
export function isoWeekKeyUTC(instant: Date): string {
  const date = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  // ISO weeks belong to the year of their Thursday: shift to this week's
  // Thursday, then count weeks from that year's January 1st.
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - isoDay);
  const isoYear = date.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
