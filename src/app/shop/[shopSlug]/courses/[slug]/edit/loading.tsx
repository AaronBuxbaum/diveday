import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Form-shaped skeleton for the course editor (design principle 1). Without
 * one, this route would inherit the public course page's hero-shaped
 * skeleton from the parent segment — a shape mismatch for a staff form.
 */
export default function EditCourseLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description={false} />
        <div className="mt-8 flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 rounded-lg border border-border bg-surface" />
          ))}
        </div>
      </div>
    </main>
  );
}
