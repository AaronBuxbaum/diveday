import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";

/**
 * Form-shaped skeleton for the course editor (design principle 1). Without
 * one, this route would inherit the public course page's hero-shaped
 * skeleton from the parent segment — a shape mismatch for a staff form.
 *
 * Rail-and-sections since ADR 20260827-the-shops-shelves: bars on the page
 * background rather than a stack of bordered panels, because that is what
 * replaces them. A skeleton still drawing eight cards would paint the old
 * editor for a moment on every navigation in.
 */
export default function EditCourseLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10 lg:max-w-5xl">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton description={false} />
        <div className="mt-6 lg:grid lg:grid-cols-[13.75rem_1fr] lg:gap-x-14">
          {/* The rail: a jump-row across the top on a phone, a column from `lg`. */}
          <div className="flex gap-2 overflow-hidden py-2 lg:flex-col lg:py-6">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-11 w-28 shrink-0 rounded-lg bg-surface-sunken lg:w-full" />
            ))}
          </div>
          <div className="divide-y divide-border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="py-8 first:pt-0">
                <div className="h-3 w-28 rounded bg-surface-sunken" />
                <div className="mt-4 h-11 rounded-lg bg-surface-sunken" />
                <div className="mt-5 h-24 rounded-lg bg-surface-sunken" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
