import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/** Panel-shaped skeleton for the shop's own WhatsApp sender settings. */
export default function WhatsAppSettingsLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        <div className="mt-8 h-44 rounded-2xl border border-border bg-surface" />
        <div className="mt-6 h-40 rounded-2xl border border-border bg-surface" />
      </div>
    </main>
  );
}
