/**
 * Body-shaped skeleton for the waiver template editor (design principle 1).
 * `waivers/layout.tsx` already renders the `<main>` shell and the
 * Template/Signatures tabs synchronously — this only covers what streams in
 * behind them: the template's own version info and editor.
 */
export default function WaiverTemplateLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-24 rounded bg-surface-sunken" />
      <div className="mt-3 h-9 w-64 rounded bg-surface-sunken" />
      <div className="mt-2 h-5 w-80 max-w-full rounded bg-surface-sunken" />
      <div className="mt-10">
        <div className="h-6 w-56 rounded bg-surface-sunken" />
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
        <div className="mt-4 h-96 rounded-2xl border border-border bg-surface" />
      </div>
    </div>
  );
}
