import { ShopContactLinks } from "@/components/ShopContactLinks";
import type { DiverTranslator } from "@/i18n/messages";

/** The booking decision's contact line, absent when the shop publishes no contact. */
export function TripContactLine({
  shop,
  t,
}: {
  shop: { contactPhone: string | null; contactEmail: string | null };
  t: DiverTranslator;
}) {
  if (!shop.contactPhone && !shop.contactEmail) return null;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-muted">
      {t("trip.questionsContact")}
      <ShopContactLinks phone={shop.contactPhone} email={shop.contactEmail} />
    </p>
  );
}
