import Image from "next/image";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { SectionCard } from "@/components/ui/card";
import type { diveSites } from "@/db/schema";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import { diverTranslator } from "@/i18n/messages";
import { parseDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { siteFit } from "@/lib/diver-planning";
import { DiveSiteFieldGuide } from "./DiveSiteFieldGuide";
import { DiveSiteLandmarks } from "./DiveSiteLandmarks";
import { canDrawRoute, DiveSiteMap } from "./DiveSiteMap";

/**
 * `siteFit` returns a tone, not prose (src/lib/diver-planning.ts) — these two
 * maps are where that tone becomes a sentence in the reader's own language.
 * Spelled out rather than built with a template literal so every key stays
 * statically visible to next-intl's `AppConfig` type checking.
 */
const fitLabelKey = {
  demanding: "trip.siteFitDemandingLabel",
  welcoming: "trip.siteFitWelcomingLabel",
  unknown: "trip.siteFitUnknownLabel",
} as const;
const fitDetailKey = {
  demanding: "trip.siteFitDemandingDetail",
  welcoming: "trip.siteFitWelcomingDetail",
  unknown: "trip.siteFitUnknownDetail",
} as const;

type Site = typeof diveSites.$inferSelect;
type Creature = Parameters<typeof DiveSiteFieldGuide>[0]["creatures"][number];
type Moment = { imageUrl: string | null; caption: string };

export function DiveBriefingCard({
  diveNumber,
  title,
  description,
  site,
  creatures,
  moments,
  leadWithFieldGuide = false,
  locale,
}: {
  diveNumber: number;
  title: string | null;
  description: string | null;
  site: Site | null;
  creatures: Creature[];
  moments: Moment[];
  /**
   * **Put the species photos in front of a diver who has not booked yet.**
   *
   * They are the only photography on the page a diver decides to spend $95
   * on — a licensed, credited grid of what they would actually see down there
   * — and they were folded inside the disclosure below, whose closed summary
   * reads "What to look for down there · 3 landmarks · 8 species" (issue
   * #760). The page comment that justified folding it argues about the
   * *confirmed* state: a just-paid diver should reach their confirmation
   * without scrolling past a creature gallery. That is right, and it is the
   * only state this stays folded for.
   *
   * The landmarks and the moment figure stay in the disclosure either way.
   * They are reference for someone already going; the pictures are the
   * argument for someone deciding.
   */
  leadWithFieldGuide?: boolean;
  /** The negotiated request locale, not the shop's stored default. */
  locale: string;
}) {
  const t = diverTranslator(locale);
  const heading = title || site?.name || t("trip.diveNumber", { number: diveNumber });
  // Under the heading: where this tank is, or — when the crew hasn't chosen it
  // yet — the fact that they haven't. Silence there is what made a two-tank day
  // with one site look like a mismatch between the sites and the briefings.
  const subheading = site ? site.locationName : t("trip.siteToBeConfirmed");
  const fit = site ? siteFit(site) : null;
  const difficulty = diveSiteDifficultyLabel(site?.difficultyLevel, t);
  const landmarks = site ? parseDiveSiteLandmarks(site.landmarks) : [];
  const hasFieldGuide =
    creatures.length > 0 || Boolean(site?.marineLifeDescription) || Boolean(site?.marineLife);
  // Above the fold for a diver still deciding, inside it for one who has
  // already paid — see `leadWithFieldGuide`.
  const fieldGuideLeads = leadWithFieldGuide && Boolean(site) && hasFieldGuide;
  // The long-tail site content folds behind one tap so the page stays a
  // briefing, not a scroll marathon — the essentials above stay in view. What
  // counts as long-tail depends on where the field guide went: once it leads,
  // the disclosure holds the landmarks and the moment alone, and a card with
  // neither has no disclosure at all rather than an empty one.
  const hasSiteExtras =
    landmarks.length > 0 || Boolean(moments[0]) || (!fieldGuideLeads && hasFieldGuide);
  const extrasHint = [
    landmarks.length > 0 ? t("trip.siteLandmarkCount", { count: landmarks.length }) : null,
    // Never advertise species the disclosure no longer holds.
    creatures.length > 0 && !fieldGuideLeads
      ? t("trip.siteSpeciesCount", { count: creatures.length })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // First-party by construction, like the site's own map still below: a
  // staff-pasted moment URL is fetched and re-stored at save time, never
  // persisted raw.
  const momentImageUrl = moments[0]?.imageUrl ?? null;

  return (
    // A shell: the site map (or satellite photo) runs to the card's edge, and
    // the prose block below it pads itself.
    <SectionCard
      as="article"
      padding="none"
      className="w-[min(90vw,42rem)] shrink-0 snap-center self-start overflow-hidden sm:w-full"
    >
      {site && canDrawRoute(site) ? (
        <DiveSiteMap site={site} t={t} />
      ) : site?.satelliteImageUrl ? (
        <div className="relative h-56 w-full">
          {/* First-party blob URL only — uploaded by staff into this app's own
              storage (src/lib/storage/dive-site-photos.ts), never a live
              third-party host a shop pasted a link to. */}
          <Image
            src={site.satelliteImageUrl}
            alt={t("trip.siteMapAlt", { site: site.name })}
            fill
            sizes="(min-width: 640px) 42rem, 90vw"
            className="object-cover"
          />
        </div>
      ) : null}
      <div className="p-5 sm:p-6">
        <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
          {t("trip.diveNumber", { number: diveNumber })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h3>
        {/* A tank with no site yet says so. Without this line a two-tank day
            with one chosen site reads as two briefings and one site — the same
            data, silently short one answer — instead of as the plan it is:
            the crew names the second site at the dock. */}
        {subheading ? <p className="mt-1 text-sm text-muted">{subheading}</p> : null}
        {description || site?.description ? (
          <p className="mt-4 leading-relaxed text-muted">{description || site?.description}</p>
        ) : (
          <p className="mt-4 text-muted">{t("trip.siteRouteAtDock")}</p>
        )}
        {site && (difficulty || site.depthRange || site.currentNote || site.fitNote) ? (
          <div className="mt-5 rounded-lg bg-primary-tint p-4">
            <p className="font-semibold text-primary">{fit ? t(fitLabelKey[fit.tone]) : null}</p>
            {/* The shop's own sentence about who this site suits, when it has
                written one — DiveDay's canned line only stands in for a site
                nobody has said anything about yet. */}
            <p className="mt-1 text-sm text-muted">
              {site.fitNote || (fit ? t(fitDetailKey[fit.tone]) : null)}
            </p>
            <p className="mt-2 text-xs text-muted">{t("trip.sitePlanningGuide")}</p>
          </div>
        ) : null}
        {site && (difficulty || site.depthRange || site.currentNote) ? (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                {t("trip.columnExperience")}
              </dt>
              {/* No `capitalize` any more: the word is a translated label now,
                  and a bundle decides its own casing. Title-casing a Spanish
                  sentence fragment in CSS is how "Principiante" would have
                  become something a translator never wrote. */}
              <dd className="mt-1 font-semibold">{difficulty ?? t("common.crewLed")}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                {t("trip.columnDepth")}
              </dt>
              <dd className="mt-1 font-semibold">{site.depthRange ?? t("common.varies")}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                {t("trip.columnWaterMovement")}
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {site.currentNote ?? t("common.confirmedAtDock")}
              </dd>
            </div>
          </dl>
        ) : null}
        {site?.divePlan ? (
          <section className="mt-7">
            <h4 className="font-semibold">{t("trip.siteHowItUnfolds")}</h4>
            <p className="mt-2 leading-relaxed text-muted">{site.divePlan}</p>
          </section>
        ) : null}
        {site?.conservationNote ? (
          <section className="mt-7">
            <h4 className="font-semibold">{t("trip.siteConservationHeading")}</h4>
            <p className="mt-2 leading-relaxed text-muted">{site.conservationNote}</p>
          </section>
        ) : null}
        {fieldGuideLeads && site ? (
          <div className="mt-7 border-t border-border pt-5">
            <DiveSiteFieldGuide
              creatures={creatures}
              summary={site.marineLifeDescription}
              highlights={site.marineLife}
              tipsHeading={site.fieldGuideTipsHeading}
              t={t}
            />
          </div>
        ) : null}
        {hasSiteExtras ? (
          <details className="group mt-7 border-t border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">{t("trip.siteWhatToLookFor")}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
                {extrasHint ? <span className="tabular-nums">{extrasHint}</span> : null}
                <DiveDayIcon
                  name="caret"
                  direction="down"
                  className="size-3 transition-transform ease-out group-open:rotate-180"
                />
              </span>
            </summary>
            <DiveSiteLandmarks landmarks={landmarks} t={t} />
            {site && !fieldGuideLeads ? (
              <DiveSiteFieldGuide
                creatures={creatures}
                summary={site.marineLifeDescription}
                highlights={site.marineLife}
                tipsHeading={site.fieldGuideTipsHeading}
                t={t}
              />
            ) : null}
            {moments[0] ? (
              <figure className="mt-6 overflow-hidden rounded-lg bg-accent/10 sm:grid sm:grid-cols-[12rem_1fr]">
                {momentImageUrl ? (
                  <div className="relative aspect-video h-full w-full sm:aspect-square">
                    <Image
                      src={momentImageUrl}
                      alt={t("trip.siteMomentAlt", { site: site?.name ?? heading })}
                      fill
                      sizes="(min-width: 640px) 12rem, 100vw"
                      className="object-cover"
                    />
                  </div>
                ) : null}
                <figcaption className="p-4 sm:self-center">
                  <h4 className="font-semibold">{t("trip.siteMomentHeading")}</h4>
                  <p className="mt-1 text-sm text-muted">{moments[0].caption}</p>
                </figcaption>
              </figure>
            ) : null}
          </details>
        ) : null}
      </div>
    </SectionCard>
  );
}
