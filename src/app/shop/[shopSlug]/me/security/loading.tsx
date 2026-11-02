import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { staffPageClass } from "../../_components/staff-page";

export default function SecurityLoading() {
  return (
    <main className={staffPageClass("reading")}>
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton eyebrow={false} titleWidth="w-56" description={false} />
        {/* The page's own rhythm: one `space-y-10` between its sections, and
            the header's `mb-8` above them (K-521). */}
        <div className="space-y-10">
          <div className={sectionCardClass({ padding: "md", className: "h-48" })} />
          <div className={sectionCardClass({ padding: "md", className: "h-64" })} />
        </div>
      </div>
    </main>
  );
}
