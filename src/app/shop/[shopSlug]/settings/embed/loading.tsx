import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/** Panel-shaped skeleton for the embeddable-schedule settings. */
export default function EmbedSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 h-40 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 h-64 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
