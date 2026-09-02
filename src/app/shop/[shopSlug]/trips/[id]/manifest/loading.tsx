import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Roll-call-shaped skeleton for the boat manifest (design principle 1). Like
 * its sibling `trips/[id]/loading.tsx` this renders as the trip layout's
 * children, so the sub-nav above stays put and only the manifest body swaps —
 * a captain switching to Manifest at the dock sees the list frame immediately
 * rather than a held page on marina Wi-Fi.
 *
 * Shaped to the surface as it is since ADR
 * 20260827-the-departure-is-two-working-surfaces: **the count leads**, then the
 * checkpoint switch, then the one-line boat check, then the ruled list of rows
 * whose trailing edge is a 56px mark. It used to draw the checkpoint switch
 * first and rows with no mark at all, which is a picture of the previous
 * page — the skeleton a reader watches has to be the page they land on, or the
 * whole boundary is a layout jump with extra steps.
 */
export default function ManifestLoading() {
  return (
    <div className="animate-pulse">
      <ShopPageHeaderSkeleton
        eyebrow={false}
        titleWidth="w-64 max-w-full"
        descriptionWidth="w-72 max-w-full"
        meta={<div className="h-6 w-56 max-w-full rounded bg-surface-sunken" />}
      />
      {/* The count panel: the fraction, the bar, and the row of counts. */}
      <div className={sectionCardClass({ padding: "md", className: "mt-4 h-36" })} />
      {/* The checkpoint switch, then the boat check's one line. */}
      <div className="mt-7 h-12 w-full rounded-inset bg-surface-sunken" />
      <div className={sectionCardClass({ padding: "none", className: "mt-5 h-14" })} />
      {/* The roll call is one ruled list card, so its skeleton is the same
          single card — not a stack of floating bars that redraws into a
          different shape when the list streams in. */}
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-9 divide-y divide-border overflow-hidden",
        })}
      >
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <li
            key={i}
            className="flex h-19 items-center gap-3 border-l-4 border-border-strong bg-surface-sunken/60 ps-4 pe-3"
          >
            <div className="size-8 shrink-0 rounded-lg bg-surface-sunken" />
            <div className="h-4 w-40 max-w-full flex-1 rounded bg-surface-sunken" />
            <div className="size-14 shrink-0 rounded-full bg-surface-sunken" />
          </li>
        ))}
      </ul>
      <div className={sectionCardClass({ padding: "md", className: "mt-8 h-28" })} />
    </div>
  );
}
