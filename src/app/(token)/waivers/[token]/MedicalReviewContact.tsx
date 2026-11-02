import type { DiverTranslator } from "@/i18n/messages";
import { telHref } from "@/lib/contact-links";

/**
 * Who a diver on a medical hold talks to next, in the shop's own channels: a
 * phone and an email, either alone, or neither (then the shop by name). The
 * completed waiver's held state renders it under "a doctor must confirm".
 */
export function MedicalReviewContact({
  shop,
  t,
}: {
  shop: { name: string; contactEmail: string | null; contactPhone: string | null };
  t: DiverTranslator;
}) {
  return (
    <p className="mt-3 font-medium text-foreground">
      {shop.contactEmail && shop.contactPhone
        ? t.rich("waiver.medicalContactBoth", {
            shop: shop.name,
            phoneNumber: shop.contactPhone,
            emailAddress: shop.contactEmail,
            phone: (chunks) => (
              <a href={telHref(shop.contactPhone ?? "")} className="hover:underline">
                {chunks}
              </a>
            ),
            email: (chunks) => (
              <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
                {chunks}
              </a>
            ),
          })
        : shop.contactPhone
          ? t.rich("waiver.medicalContactPhoneOnly", {
              shop: shop.name,
              phoneNumber: shop.contactPhone,
              phone: (chunks) => (
                <a href={telHref(shop.contactPhone ?? "")} className="hover:underline">
                  {chunks}
                </a>
              ),
            })
          : shop.contactEmail
            ? t.rich("waiver.medicalContactEmailOnly", {
                shop: shop.name,
                emailAddress: shop.contactEmail,
                email: (chunks) => (
                  <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
                    {chunks}
                  </a>
                ),
              })
            : t("waiver.medicalContactNone", { shop: shop.name })}
    </p>
  );
}
