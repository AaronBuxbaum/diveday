/**
 * List-shaped skeleton for collected waiver signatures — renders as the
 * waivers layout's children, so the Template/Signatures tabs stay put while
 * only the body swaps.
 */
export default function WaiverSignaturesLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-24 rounded bg-surface-sunken" />
      <div className="mt-3 h-9 w-56 rounded bg-surface-sunken" />
      <div className="mt-2 h-4 w-full max-w-xl rounded bg-surface-sunken" />
      <div className="mt-8 flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 bg-surface" />
        ))}
      </div>
    </div>
  );
}
