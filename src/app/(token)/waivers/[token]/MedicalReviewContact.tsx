import type { ReactNode } from "react";
import type { DiverTranslator } from "@/i18n/messages";
import { telHref } from "@/lib/contact-links";

/**
 * Who a diver on a medical hold talks to next, in the shop's own channels: a
 * phone and an email, either alone, or neither (then the shop by name). The
 * completed waiver's held state renders it under "a doctor must confirm".
 * On the doctor's sheet (`paper`) each channel is its words, with nothing to
 * tap (issue #2745).
 */
export function MedicalReviewContact({
  shop,
  t,
  paper = false,
}: {
  shop: { name: string; contactEmail: string | null; contactPhone: string | null };
  t: DiverTranslator;
  paper?: boolean;
}) {
  const phone = (chunks: ReactNode) =>
    paper ? (
      <span>{chunks}</span>
    ) : (
      <a href={telHref(shop.contactPhone ?? "")} className="hover:underline">
        {chunks}
      </a>
    );
  const email = (chunks: ReactNode) =>
    paper ? (
      <span>{chunks}</span>
    ) : (
      <a href={`mailto:${shop.contactEmail}`} className="hover:underline">
        {chunks}
      </a>
    );
  return (
    <p className="mt-3 font-medium text-foreground">
      {shop.contactEmail && shop.contactPhone
        ? t.rich("waiver.medicalContactBoth", {
            shop: shop.name,
            phoneNumber: shop.contactPhone,
            emailAddress: shop.contactEmail,
            phone,
            email,
          })
        : shop.contactPhone
          ? t.rich("waiver.medicalContactPhoneOnly", {
              shop: shop.name,
              phoneNumber: shop.contactPhone,
              phone,
            })
          : shop.contactEmail
            ? t.rich("waiver.medicalContactEmailOnly", {
                shop: shop.name,
                emailAddress: shop.contactEmail,
                email,
              })
            : t("waiver.medicalContactNone", { shop: shop.name })}
    </p>
  );
}
