import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeaderSkeleton } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { FieldActions, FieldGrid } from "@/components/ui/form";

/**
 * Form-shaped skeleton for creating a new diver: the name/email/phone trio on
 * the form's own three-up `FieldGrid`, and its two md buttons on the form's own
 * `FieldActions` row. It drew the fields stacked at every width and one 44px
 * bar under them, so at `sm`+ the card changed shape when the form arrived
 * (pixel-craft class 11, K-304). Each slot is a caption bar and a control bar,
 * the 20 + 4 + 44px a `Field` draws.
 */
export default function NewDiverLoading() {
  return (
    <StaffPage width="reading">
      <div className="animate-pulse">
        <ShopPageHeaderSkeleton titleWidth="w-48" description={false} />
        <div className={sectionCardClass({ padding: "lg", className: "mt-6" })}>
          <FieldGrid columns={3}>
            {["fullName", "email", "phone"].map((slot) => (
              <div key={slot}>
                <div className="h-4 w-24 rounded bg-surface-sunken" />
                <div className="mt-2 h-12 w-full rounded-lg bg-surface-sunken" />
              </div>
            ))}
            <FieldActions>
              <div className="h-12 w-32 rounded-lg bg-surface-sunken" />
              <div className="h-12 w-24 rounded-lg bg-surface-sunken" />
            </FieldActions>
          </FieldGrid>
        </div>
      </div>
    </StaffPage>
  );
}
