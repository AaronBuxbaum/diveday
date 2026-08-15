import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

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
      <ul className="mt-6 flex flex-col gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="h-20 rounded-lg border border-border bg-surface" />
        ))}
      </ul>
    </div>
  );
}
