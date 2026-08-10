import Image from "next/image";
import type { diveSites } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { buildDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
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
  locale,
}: {
  diveNumber: number;
  title: string | null;
  description: string | null;
  site: Site | null;
  creatures: Creature[];
  moments: Moment[];
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
  const landmarks = site ? buildDiveSiteLandmarks(site.name, site.landmarks) : [];
  // The long-tail site content folds behind one tap so the page stays a
  // briefing, not a scroll marathon — the essentials above stay in view.
  const hasSiteExtras =
    landmarks.length > 0 ||
    creatures.length > 0 ||
    Boolean(site?.marineLifeDescription) ||
    Boolean(site?.marineLife) ||
    Boolean(moments[0]);
  const extrasHint = [
    landmarks.length > 0 ? t("trip.siteLandmarkCount", { count: landmarks.length }) : null,
    creatures.length > 0 ? t("trip.siteSpeciesCount", { count: creatures.length }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // First-party by construction, like the satellite image below: a staff-pasted
  // moment URL is fetched and re-stored at save time, never persisted raw.
  const momentImageUrl = moments[0]?.imageUrl ?? null;

  return (
    <article className="w-[min(90vw,42rem)] shrink-0 snap-center self-start overflow-hidden rounded-2xl border border-border bg-surface sm:w-full">
      {site && canDrawRoute(site) ? (
        <DiveSiteMap site={site} t={t} />
      ) : site?.satelliteImageUrl ? (
        <div className="relative h-56 w-full">
          {/* First-party blob/bundled URL only — ingested server-side at save time
              (CR-020, src/lib/storage/ingest-dive-site-media.ts), never a live third-party host. */}
          <Image
            src={site.satelliteImageUrl}
            alt={t("trip.siteSatelliteAlt", { site: site.name })}
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
        {site && (site.difficulty || site.depthRange || site.currentNote) ? (
          <div className="mt-5 rounded-lg bg-primary/10 p-4">
            <p className="font-semibold text-primary">{fit ? t(fitLabelKey[fit.tone]) : null}</p>
            <p className="mt-1 text-sm text-muted">{fit ? t(fitDetailKey[fit.tone]) : null}</p>
            <p className="mt-2 text-xs text-muted">{t("trip.sitePlanningGuide")}</p>
          </div>
        ) : null}
        {site && (site.difficulty || site.depthRange || site.currentNote) ? (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                {t("trip.columnExperience")}
              </dt>
              <dd className="mt-1 font-semibold capitalize">
                {site.difficulty ?? t("common.crewLed")}
              </dd>
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
        {hasSiteExtras ? (
          <details className="group mt-7 border-t border-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-3 [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">{t("trip.siteWhatToLookFor")}</span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
                {extrasHint ? <span className="tabular-nums">{extrasHint}</span> : null}
                <span
                  aria-hidden="true"
                  className="transition-transform duration-200 ease-out group-open:rotate-180"
                >
                  ▾
                </span>
              </span>
            </summary>
            <DiveSiteLandmarks landmarks={landmarks} t={t} />
            {site ? (
              <DiveSiteFieldGuide
                creatures={creatures}
                summary={site.marineLifeDescription}
                highlights={site.marineLife}
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
    </article>
  );
}
