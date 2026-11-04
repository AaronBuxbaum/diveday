import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * The packages page's own skeleton (ADR 20260804-instant-navigation): the
 * page's `max-w-3xl` column, its eyebrow-less header, then the shape of the
 * one form — two 44px+ package pills, the name and email boxes side by side
 * from `sm`, and the Buy button. Without it the route fell back to the
 * schedule's skeleton at the wrong width.
 */
export default function PublicPackagesLoading() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Pending>
        <ShopPageHeader pending eyebrow={false} titleWidth="w-56" description={false} />
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            {[0, 1].map((row) => (
              <Bone shape="control" key={row} className="h-16" />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1].map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <Bone className="h-5 w-16" />
                <Bone shape="control" className="h-11" />
              </div>
            ))}
          </div>
          <Bone shape="control" className="h-11 w-40" />
        </div>
      </Pending>
    </main>
  );
}
