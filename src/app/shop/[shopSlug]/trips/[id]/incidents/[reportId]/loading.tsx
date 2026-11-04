import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * The incident report's skeleton, drawn as the trip layout's children like its
 * siblings: the header (eyebrow back to the departure, the title, the two- or
 * three-line note, then the status and departure line), and the report's
 * first two cards at the height a fresh draft's fields take.
 */
export default function IncidentReportLoading() {
  return (
    <Pending className="space-y-10">
      <ShopPageHeader
        pending
        titleWidth="w-56 max-w-full"
        description
        descriptionWidth="w-160 max-w-full"
        descriptionLines={{ base: 4, sm: 2 }}
        meta={<Bone className="h-6 w-72 max-w-full" />}
      />
      <SectionCard as="div" pending className="h-136" />
      <SectionCard as="div" pending className="h-96" />
    </Pending>
  );
}
