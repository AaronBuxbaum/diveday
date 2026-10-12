import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";

/**
 * The incident report's skeleton, drawn as the trip layout's children like its
 * siblings: the header (eyebrow back to the departure, the title, the two- or
 * three-line note, then the status and departure line), and the report's
 * first two cards at the height a fresh draft's fields take.
 */
export default function IncidentReportLoading() {
  return (
    <div className="animate-pulse space-y-10">
      <ShopPageHeaderSkeleton
        titleWidth="w-56 max-w-full"
        description
        descriptionWidth="w-160 max-w-full"
        descriptionLines={{ base: 4, sm: 2 }}
        meta={<div className="h-6 w-72 max-w-full rounded bg-surface-sunken" />}
      />
      <div className={sectionCardClass({ className: "h-136" })} />
      <div className={sectionCardClass({ className: "h-96" })} />
    </div>
  );
}
