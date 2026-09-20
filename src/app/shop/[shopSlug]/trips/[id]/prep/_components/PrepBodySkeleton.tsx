import { sectionCardClass } from "@/components/ui/card";

/**
 * The packing list's own shape while its reads are in flight — three tank
 * tiles, the kit cards, the assignments table.
 *
 * Its own file rather than a second export from `PrepBody.tsx`: both callers
 * are boundaries a reader waits at, and importing the list itself would pull
 * the gear actions and both pickers into the chunk that is supposed to paint
 * first.
 */
export function PrepBodySkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-6 w-32 rounded bg-surface-sunken" />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
        ))}
      </div>
      <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
      <div className="mt-8 flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className={sectionCardClass({ padding: "md", className: "h-36" })} />
        ))}
      </div>
      <div className="mt-8 h-6 w-40 rounded bg-surface-sunken" />
      <div className={sectionCardClass({ padding: "none", className: "mt-3 h-64" })} />
    </div>
  );
}
