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
  function species(slug: "spotted-eagle-ray" | "green-sea-turtle" | "blue-tang", detail: string) {
    const name = t(`marineLife.species.${slug}.name`);
    return { name, detail, inspect: t("marketing.home.boat.dive.inspect", { name }) };
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
          deskPoster={poster(
            "/marketing/boat-check-in.webp",
            t("marketing.home.boat.desk.imageAlt"),
          )}
          dockPoster={poster(
            "/marketing/boat-dock.webp",
            t("marketing.home.boat.dockIllustration"),
          )}
          reefPoster={poster(
            "/marketing/boat-roll-call.webp",
            t("marketing.home.boat.illustration"),
          )}
          labels={{
            dive: {
              arrival: t("marketing.home.boat.dive.arrival"),
              underwater: t("marketing.home.boat.dive.underwater"),
              scene: t("marketing.home.boat.dive.scene"),
              explore: t("marketing.home.boat.dive.explore"),
              surface: t("marketing.home.boat.dive.surface"),
              title: t("marketing.home.boat.dive.title"),
              purpose: t("marketing.home.boat.dive.purpose"),
              identify: t("marketing.home.boat.dive.identify"),
              log: t("marketing.home.boat.dive.log"),
              logged: t("marketing.home.boat.dive.logged"),
              remove: t("marketing.home.boat.dive.remove"),
              none: t("marketing.home.boat.dive.none"),
              counts: [
                t("marketing.home.boat.dive.count", { count: 0 }),
                t("marketing.home.boat.dive.count", { count: 1 }),
                t("marketing.home.boat.dive.count", { count: 2 }),
                t("marketing.home.boat.dive.count", { count: 3 }),
              ],
              species: [
                species("spotted-eagle-ray", t("marineLife.species.spotted-eagle-ray.description")),
                species("green-sea-turtle", t("marketing.home.boat.dive.turtleDetail")),
                species("blue-tang", t("marketing.home.boat.dive.tangDetail")),
              ],
            },
            desk: {
              checkpoint: t("marketing.home.boat.desk.checkpoint"),
              open: t("marketing.home.boat.desk.open"),
              pin: t("marketing.home.boat.desk.pin"),
              booking: t("marketing.home.boat.desk.booking"),
              cardTitle: t("marketing.home.boat.desk.cardTitle"),
              match: t("marketing.home.boat.desk.match"),
              mismatch: t("marketing.home.boat.desk.mismatch"),
              hold: t("marketing.home.boat.desk.hold"),
              recheck: t("marketing.home.boat.desk.recheck"),
              verified: t("marketing.home.boat.desk.verified"),
              otherCard: t("marketing.home.boat.desk.otherCard"),
              number: t("marketing.home.boat.desk.number"),
              pending: t("marketing.home.boat.desk.pending"),
              prompt: t("marketing.home.boat.desk.prompt"),
              compare: t("marketing.home.boat.desk.compare"),
              agencyChecked: t("marketing.home.boat.desk.agencyChecked"),
              holdHint: t("marketing.home.boat.desk.holdHint"),
              tomCard: t("marketing.home.boat.desk.tomCard"),
              previouslyChecked: t("marketing.home.boat.desk.previouslyChecked"),
              tomLevel: t("course.certificationLevels.rescue"),
              corrected: t("marketing.home.boat.desk.corrected"),
              // i18n-exempt: certification agency name
              issuedBy: "PADI",
              level: t("course.certificationLevels.advancedOpenWater"),
            },
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
