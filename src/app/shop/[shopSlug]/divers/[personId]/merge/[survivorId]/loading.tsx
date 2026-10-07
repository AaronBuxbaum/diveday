import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/** Shaped like the merge preview: its header, the details table, the moves table, the button. */
export default function MergeDiverLoading() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description={false} />
        <div className="mt-8 space-y-10">
          {["h-96", "h-64"].map((height) => (
            <div
              key={height}
              className={`${height} rounded-panel border border-border bg-surface`}
            />
          ))}
          <div className="h-12 w-56 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
