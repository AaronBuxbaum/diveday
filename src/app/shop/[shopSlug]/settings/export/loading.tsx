import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Header + the bundle's (collapsed) summary card + the backups half (status
 * card and destination form), so the one data-out surface never blocks blank
 * (ADR 20260806-one-data-out-surface).
 *
 * The bundle's file list used to be modelled here as eight card-shaped bars,
 * because the section rendered open. It is a closed `<details>` now — a
 * heading and a file count — and a skeleton that promised the taller shape
 * would collapse the moment the page arrived, which is the jump these files
 * exist to prevent.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 rounded-2xl border border-border bg-surface p-6">
          <div className="h-5 w-44 rounded bg-surface-sunken" />
          <div className="mt-2 h-4 w-56 rounded bg-surface-sunken" />
        </div>
        <div className="mt-10">
          <div className="h-5 w-28 rounded bg-surface-sunken" />
          <div className="mt-4 rounded-lg border border-border bg-surface p-6">
            <div className="h-5 w-44 rounded bg-surface-sunken" />
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {["a", "b", "c", "d"].map((slot) => (
                <div key={slot} className="h-10 rounded-lg bg-surface-sunken" />
              ))}
            </div>
          </div>
          <div className="mt-6 rounded-lg border border-border bg-surface p-6">
            <div className="h-5 w-52 rounded bg-surface-sunken" />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {["a", "b", "c", "d", "e", "f"].map((slot) => (
                <div key={slot} className="h-11 rounded-lg bg-surface-sunken" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
