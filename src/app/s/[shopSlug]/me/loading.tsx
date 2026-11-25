import { ShopPageHeader } from "@/components/ShopPageHeader";
import { Bone, Pending } from "@/components/ui/pending";

/** My profile's skeleton: the header, then its stacked cards at their column width. */
export default function DiverProfileLoading() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <Pending>
        <ShopPageHeader
          pending
          eyebrow={false}
          titleWidth="w-48"
          description
          descriptionWidth="w-72 max-w-full"
        />
        {[0, 1, 2].map((card) => (
          <Bone key={card} shape="control" className="h-32" />
        ))}
      </Pending>
    </main>
  );
}
