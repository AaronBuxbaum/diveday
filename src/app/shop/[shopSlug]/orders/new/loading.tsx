import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Form-shaped skeleton for recording a new order. */
export default function NewOrderLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-56" descriptionWidth="w-full max-w-xl" />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          {["diver", "item", "amount", "note"].map((slot) => (
            <div key={slot} className="mt-4 first:mt-0">
              <div className="h-4 w-24 rounded bg-surface-sunken" />
              <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
            </div>
          ))}
          <div className="mt-6 h-11 w-44 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
