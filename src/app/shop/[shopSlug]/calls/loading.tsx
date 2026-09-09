import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/** Form-shaped skeleton for "Took a call": the caller's three boxes, then the choice. */
export default function TookACallLoading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" />
        <div className={sectionCardClass({ padding: "lg", className: "mt-8" })}>
          <div className="h-5 w-32 rounded bg-surface-sunken" />
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {["name", "email", "phone"].map((slot) => (
              <div key={slot}>
                <div className="h-4 w-20 rounded bg-surface-sunken" />
                <div className="mt-2 h-11 w-full rounded-lg bg-surface-sunken" />
              </div>
            ))}
          </div>
          <div className="mt-6 h-4 w-28 rounded bg-surface-sunken" />
          <div className="mt-2 grid gap-2">
            {["one", "two", "three"].map((slot) => (
              <div key={slot} className="h-11 w-full rounded-lg bg-surface-sunken" />
            ))}
          </div>
          <div className="mt-6 h-11 w-36 rounded-lg bg-surface-sunken" />
        </div>
      </div>
    </main>
  );
}
