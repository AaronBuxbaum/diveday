/**
 * Panel-shaped skeleton for shop settings (design principle 1). It is also the
 * fallback the settings sub-pages inherit when they have none of their own.
 */
export default function SettingsLoading() {
  return (
    // max-w-3xl to match SettingsPage — a wider skeleton made every navigation
    // into Settings jump sideways when the real page landed.
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-20 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-48 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-2xl border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
