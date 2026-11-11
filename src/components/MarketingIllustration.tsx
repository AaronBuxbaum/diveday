import Image from "next/image";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/** Editorial atmosphere, never evidence of a customer or a product capability.
 * Keep the complete scene visible and the real product demonstrations separate.
 * These sit below the first demo door, so they load lazily rather than competing
 * with the first screen. Intrinsic dimensions reserve their space before loading.
 */
export function MarketingIllustration({
  scene,
  locale,
}: {
  scene: "harbor" | "classroom" | "gear-handover";
  locale: DiverLocale;
}) {
  const t = diverTranslator(locale);
  return (
    <figure className="min-w-0" data-marketing-illustration={scene}>
      <Image
        src={`/marketing/${scene}.webp`}
        alt={t(`marketing.illustrations.${scene}Alt`)}
        width={1536}
        height={1024}
        sizes="(min-width: 1280px) 600px, (min-width: 1024px) 50vw, calc(100vw - 48px)"
        loading="lazy"
        className="h-auto w-full rounded-panel"
      />
      <figcaption className="mt-2 text-xs leading-5 text-muted">
        {t("marketing.illustrations.caption")}
      </figcaption>
    </figure>
  );
}
