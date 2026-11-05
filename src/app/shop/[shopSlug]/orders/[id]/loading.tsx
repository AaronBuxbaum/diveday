import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { Bone, Pending } from "@/components/ui/pending";

/**
 * Receipt-shaped skeleton for one order (design principle 1) — line items,
 * payment state is read per request.
 *
 * The shell comes from `sectionCardClass({ padding: "lg" })`, the same call
 * the page's own receipt card makes, so the two cannot drift apart.
 *
 * **The header carries the page's `meta` line** (K-244): every order says
 * when it was raised, by whom, and links the diver's record, one 20px
 * `text-sm` line in the header's `mt-3`. Without its bar the card sat 32px high
 * and dropped when the order arrived. The card takes no margin of its own: the
 * header's `mb-8` is the gap, and a second one only collapses into it.
 */
export default function OrderLoading() {
  return (
    <StaffPage width="reading">
      <Pending>
        <ShopPageHeader
          pending
          titleWidth="w-64 max-w-full"
          description
          descriptionWidth="w-48"
          meta={<Bone className="h-5 w-80 max-w-full" />}
        />
        <SectionCard as="div" pending padding="lg">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Bone shape="inset" key={i} className="h-12" />
            ))}
          </div>
        </SectionCard>
      </Pending>
    </StaffPage>
  );
}
