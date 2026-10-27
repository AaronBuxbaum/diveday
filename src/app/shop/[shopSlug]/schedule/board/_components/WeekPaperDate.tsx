/** A departure's full date and shop zone survive an oversized day's page break. */
export function WeekPaperDate({ label }: { label: string }) {
  return (
    <p data-week-paper-date className="hidden text-xs text-muted print:block">
      {label}
    </p>
  );
}
