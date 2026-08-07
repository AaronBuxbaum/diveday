/**
 * Body-shaped skeleton for the blow-out page (ADR 20260804-instant-navigation):
 * header, the three-stat outcome row, then the diver table. Mirrors the page's
 * own markup — like the page, no `<main>` of its own; the shop layout's
 * `#shop-main-content` wrapper is the landmark.
 */
export default function BlowoutLoading() {
  return (
    <div className="animate-pulse">
      <div className="mb-8">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-3 h-4 w-80 max-w-full rounded bg-surface-sunken" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-2xl border border-border bg-surface shadow-sm" />
    </div>
  );
}
