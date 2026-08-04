/** Panel-shaped skeleton for the embeddable-schedule settings. */
export default function EmbedSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <div className="h-4 w-20 rounded bg-surface-sunken" />
        <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-full max-w-xl rounded bg-surface-sunken" />
        <div className="mt-8 h-40 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 h-64 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
