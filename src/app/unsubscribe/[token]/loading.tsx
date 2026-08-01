/** Body-shaped skeleton for /unsubscribe (design principle 1) — the token lookup has no partial state to show meanwhile. */
export default function UnsubscribeLoading() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16">
      <div className="animate-pulse rounded-2xl border border-border bg-surface p-7">
        <div className="mx-auto h-7 w-56 max-w-full rounded bg-surface-sunken" />
        <div className="mx-auto mt-4 h-4 w-full rounded bg-surface-sunken" />
        <div className="mx-auto mt-2 h-4 w-2/3 rounded bg-surface-sunken" />
        <div className="mx-auto mt-6 h-10 w-40 rounded-full bg-surface-sunken" />
      </div>
    </main>
  );
}
