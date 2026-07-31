import type { diveSites } from "@/db/schema";
import { diverTranslator } from "@/i18n/messages";
import { buildDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { getSeedDiveSiteMap } from "@/lib/dive-site-map";
import { resolveDiveSiteImageUrl } from "@/lib/dive-site-media";
import { siteFit } from "@/lib/diver-planning";
import { DiveSiteFieldGuide } from "./DiveSiteFieldGuide";
import { DiveSiteLandmarks } from "./DiveSiteLandmarks";
import { DiveSiteMap } from "./DiveSiteMap";

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

  return (
    <article className="w-[min(90vw,42rem)] shrink-0 snap-center self-start overflow-hidden rounded-2xl border border-border bg-surface sm:w-full">
      {site && getSeedDiveSiteMap(site.name) ? (
        <DiveSiteMap siteName={site.name} t={t} />
      ) : site?.satelliteImageUrl ? (
        // biome-ignore lint/performance/noImgElement: first-party blob/bundled URL only — ingested server-side at save time (CR-020), never a live third-party host.
        <img
          src={site.satelliteImageUrl}
          alt={t("trip.siteSatelliteAlt", { site: site.name })}
          loading="lazy"
          className="h-56 w-full object-cover"
        />
      ) : null}
      <div className="p-5 sm:p-6">
        <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
          {t("trip.diveNumber", { number: diveNumber })}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h3>
        {site?.locationName ? <p className="mt-1 text-sm text-muted">{site.locationName}</p> : null}
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
                {moments[0].imageUrl ? (
                  // biome-ignore lint/performance/noImgElement: moderated dive-site media supports approved external hosts.
                  <img
                    src={resolveDiveSiteImageUrl(moments[0].imageUrl) ?? undefined}
                    alt={t("trip.siteMomentAlt", { site: site?.name ?? heading })}
                    loading="lazy"
                    className="aspect-video h-full w-full object-cover sm:aspect-square"
                  />
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
