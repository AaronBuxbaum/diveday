/**
 * Document-shaped skeleton for the incident-ready export (design principle 1).
 * Like its sibling `manifest/loading.tsx` this renders as the trip layout's
 * children, so the sub-nav stays put and only the document body swaps in —
 * the header block, the summary tiles, and the roster table frame appear
 * immediately while the full evidence assembly runs.
 */
export default function IncidentExportLoading() {
  return (
    <div className="animate-pulse">
      <div className="border-b border-border pb-6">
        <div className="h-4 w-40 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-72 max-w-full rounded bg-surface-sunken" />
      </div>
      <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-lg border border-border bg-surface" />
        ))}
      </div>
      <div className="mt-8 h-64 w-full rounded-lg border border-border bg-surface" />
    </div>
  );
}
