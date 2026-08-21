import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * Roll-call-shaped skeleton for the boat manifest (design principle 1). Like
 * its sibling `trips/[id]/loading.tsx` this renders as the trip layout's
 * children, so the sub-nav above stays put and only the manifest body swaps —
 * a captain switching to Manifest at the dock sees the list frame immediately
 * rather than a held page on marina Wi-Fi.
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
      <div className="mt-6 h-12 w-full rounded-xl bg-surface-sunken" />
      <div className={sectionCardClass({ padding: "md", className: "mt-6 h-36" })} />
      {/* The roll call is one ruled list card, so its skeleton is the same
          single card — not a stack of floating bars that redraws into a
          different shape when the list streams in. */}
      <ul
        className={sectionCardClass({
          padding: "none",
          className: "mt-6 divide-y divide-border overflow-hidden",
        })}
      >
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <li
            key={i}
            className="flex h-20 items-center border-l-4 border-border-strong bg-surface-sunken/60 px-4 sm:px-5"
          >
            <div className="h-4 w-40 max-w-full rounded bg-surface-sunken" />
          </li>
        ))}
      </ul>
      <div className={sectionCardClass({ padding: "md", className: "mt-8 h-28" })} />
    </div>
  );
}
