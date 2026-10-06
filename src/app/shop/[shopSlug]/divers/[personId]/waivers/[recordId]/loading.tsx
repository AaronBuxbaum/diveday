import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/** Shaped like the signed waiver: its header, the facts card, then two text cards. */
export default function SignedWaiverLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description={false} />
        <div className="mt-8 space-y-10">
          {["h-44", "h-60", "h-80"].map((height) => (
            <div
              key={height}
              className={`${height} rounded-panel border border-border bg-surface`}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
