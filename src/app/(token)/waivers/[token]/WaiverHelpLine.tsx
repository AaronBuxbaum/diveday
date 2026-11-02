import type { DiverTranslator } from "@/i18n/messages";
import { telHref } from "@/lib/contact-links";

/**
 * The signing page's closing line: where to ask for help, linked to the shop's
 * email when it has one and its phone otherwise, plain words when it has
 * neither.
 */
export function WaiverHelpLine({
  shop,
  t,
}: {
  shop: { name: string; contactEmail: string | null; contactPhone: string | null };
  t: DiverTranslator;
}) {
  return (
    <p className="mt-8 text-center text-sm text-muted">
      {shop.contactEmail || shop.contactPhone
        ? t.rich("common.needHelpContact", {
            shop: shop.name,
            link: (chunks) => (
              <a
                href={
                  shop.contactEmail
                    ? `mailto:${shop.contactEmail}`
                    : telHref(shop.contactPhone ?? "")
                }
                className="font-medium text-primary hover:underline"
              >
                {chunks}
              </a>
            ),
          })
        : t("common.needHelpPlain", { shop: shop.name })}
    </p>
  );
}
