import { sectionCardClass } from "@/components/ui/card";

/**
 * The packing list's own shape while its reads are in flight — three tank
 * tiles, the kit cards, the assignments table — stacked at the gap the caller
 * hands `PrepBody` too, so nothing moves when the list arrives.
 *
 * Its own file rather than a second export from `PrepBody.tsx`: both callers
 * are boundaries a reader waits at, and importing the list itself would pull
 * the gear actions and both pickers into the chunk that is supposed to paint
 * first.
 */
export function PrepBodySkeleton({ className }: { className: string }) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div>
        <div className="h-6 w-32 rounded bg-surface-sunken" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className={sectionCardClass({ padding: "none", className: "h-28" })} />
          ))}
        </div>
        <div className="mt-2 h-4 w-72 max-w-full rounded bg-surface-sunken" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className={sectionCardClass({ padding: "md", className: "h-36" })} />
      ))}
      <div>
        <div className="h-6 w-40 rounded bg-surface-sunken" />
        <div className={sectionCardClass({ padding: "none", className: "mt-3 h-64" })} />
      </div>
    </div>
  );
}
