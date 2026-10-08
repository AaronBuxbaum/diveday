/**
 * Body-shaped skeleton for `/offline-manifest` (UX audit 2026-10-07, item
 * 42): the eyebrow and title `OfflineManifestView` opens with, then a few
 * hairline rows where the saved copies land. The view is client-only — it
 * reads an encrypted IndexedDB snapshot with the radio off — so this is
 * what a captain sees between the cached shell and the first read, and it
 * stood blank until now. In `boat-mode` like the view, so the page does not
 * change colour when the real one arrives. The page uses it as its own
 * `<Suspense>` fallback as well, which is what the static shell paints.
 */
export default function OfflineManifestLoading() {
  return (
    <main className="boat-mode mx-auto w-full max-w-3xl flex-1 px-6 py-16">
      <div className="animate-pulse">
        <div className="h-4 w-32 rounded bg-surface-sunken" />
        <div className="mt-2 h-9 w-64 max-w-full rounded bg-surface-sunken" />
        <div className="mt-8">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border-t border-border py-4 last:border-b">
              <div className="h-5 w-56 max-w-full rounded bg-surface-sunken" />
              <div className="mt-2 h-4 w-40 max-w-full rounded bg-surface-sunken" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
