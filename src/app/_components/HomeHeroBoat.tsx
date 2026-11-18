import Image from "next/image";
import { MarketingBoatRollCall } from "@/components/MarketingBoatRollCall";
import { MarketingHeroMotion } from "@/components/MarketingReveal";
import { sectionCardClass } from "@/components/ui/card";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";

/** Two named checkpoints on a sample trip with nine divers and two crew. */
export function HomeHeroBoat({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);
  function diver(name: string, shortName: string, place: string, gear: string) {
    return {
      name,
      shortName,
      place,
      gear,
      select: t("marketing.home.boat.select", { name }),
      marker: t("marketing.home.boat.marker", { name }),
      confirm: t("marketing.home.boat.markAboard", { name: shortName }),
      dockConfirm: t("marketing.home.boat.dockConfirm", { name: shortName }),
    };
  }
  function poster(src: string, alt: string) {
    return (
      <Image
        src={src}
        width={1040}
        height={693}
        alt={alt}
        sizes="(min-width: 1200px) 512px, (min-width: 1024px) 44vw, (min-width: 496px) 448px, calc(100vw - 48px)"
        loading="eager"
        className="aspect-[3/2] w-full object-cover"
      />
    );
  }
  return (
    <MarketingHeroMotion>
      <figure
        aria-label={t("marketing.home.boat.region")}
        className={sectionCardClass({
          padding: "none",
          className: "marketing-roll-call-frame mx-auto w-full max-w-md lg:max-w-lg",
        })}
      >
        <MarketingBoatRollCall
          dockPoster={poster(
            "/marketing/boat-dock.webp",
            t("marketing.home.boat.dockIllustration"),
          )}
          reefPoster={poster(
            "/marketing/boat-roll-call.webp",
            t("marketing.home.boat.illustration"),
          )}
          labels={{
            title: t("marketing.home.boat.title"),
            dockCheckpoint: t("marketing.home.boat.dockCheckpoint"),
            dockChoose: t("marketing.home.boat.dockChoose"),
            dockAboard: t("marketing.home.boat.dockAboard"),
            dockPreviously: t("marketing.home.boat.dockPreviously"),
            depart: t("marketing.home.boat.depart"),
            rotateLeft: t("marketing.home.boat.rotateLeft"),
            rotateRight: t("marketing.home.boat.rotateRight"),
            pause: t("marketing.home.boat.pause"),
            resume: t("marketing.home.boat.resume"),
            dragHint: t("marketing.home.boat.dragHint"),
            overview: t("marketing.home.boat.overview"),
            choose: t("marketing.home.boat.choose"),
            open: t("marketing.home.boat.open"),
            closed: t("marketing.home.boat.closed"),
            counts: [
              t("marketing.home.boat.count", { aboard: 9 }),
              t("marketing.home.boat.count", { aboard: 10 }),
              t("marketing.home.boat.count", { aboard: 11 }),
            ],
            divers: [
              // i18n-exempt: sample diver names shared with the booking walkthrough
              diver(
                "Priya Sharma",
                "Priya",
                t("marketing.home.boat.stern"),
                t("marketing.home.boat.priyaGear"),
              ),
              // i18n-exempt: sample diver names shared with the booking walkthrough
              diver(
                "Tom Okafor",
                "Tom",
                t("marketing.home.boat.amidships"),
                t("marketing.home.boat.tomGear"),
              ),
            ],
            aboard: t("marketing.home.boat.aboard"),
            restart: t("marketing.home.boat.restart"),
            record: t("marketing.home.boat.record"),
            previously: t("marketing.home.boat.previously"),
            checkpoint: t("marketing.home.boat.checkpoint"),
          }}
        />
      </figure>
    </MarketingHeroMotion>
  );
}
