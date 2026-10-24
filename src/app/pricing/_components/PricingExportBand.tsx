import { Eyebrow } from "@/app/_components/Eyebrow";
import { ScreenDoor } from "@/app/_components/ScreenDoor";
import { ExportBundleFallback } from "@/components/MarketingScreenFallbacks";
import { MarginNotes, MarketingMockup } from "@/components/MarketingSections";
import { BANNER_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/** `/pricing`'s "what happens to my records if I leave?" band. */
export function PricingExportBand({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  return (
    <>
      {/* The page's other big claim: you can leave with your records any
          day. It sits here rather than in the FAQ because this is where the
          objection actually lands — the fee anchor above has just made
          switching look attractive, and the next thought a shop owner has is
          about being stuck again. The promise itself is written once, on the
          invoice's leaving row (`#export`); this band shows the screen.

          The mockup is a claim, so it mirrors the real Settings → Data export
          element for element — including the "Not included, on purpose:" line
          that says credentials never leave (docs/product/marketing.md). */}
      {/* The marketing shell's container, like every band on the page
          (visual review 2026-10-24, B12). */}
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <Eyebrow>{t("marketing.pricing.dataExit.eyebrow")}</Eyebrow>
            <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.pricing.dataExit.title")}
            </h2>
            {/* The builder's notes, each read off one row of the drawing
                beside them (docs/design/brand.md, "The builder's note"),
                ending in the one door into the demo as the owner, who is
                the role that downloads the export (issue #1955). The door
                is link-weight, so this band holds no primary and the
                page's two pairs stay its only ones. */}
            <MarginNotes
              className="mt-6"
              notes={[
                t("marketing.pricing.dataExit.note1"),
                t("marketing.pricing.dataExit.note2"),
                t("marketing.pricing.dataExit.note3"),
                t("marketing.pricing.dataExit.note4"),
                t("marketing.pricing.dataExit.securityNote"),
              ]}
            />
            <ScreenDoor
              locale={locale}
              demoRole="owner"
              source="pricing-export"
              label={t("marketing.pricing.dataExit.door")}
            />
          </div>
          <MarketingMockup label={t("marketing.pricing.dataExit.mockupLabel")}>
            <ExportBundleFallback locale={locale} />
          </MarketingMockup>
        </div>
      </section>
    </>
  );
}
