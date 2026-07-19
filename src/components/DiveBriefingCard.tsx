import type { diveSites } from "@/db/schema";
import { buildDiveSiteLandmarks } from "@/lib/dive-site-landmarks";
import { getSeedDiveSiteMap } from "@/lib/dive-site-map";
import { resolveDiveSiteImageUrl } from "@/lib/dive-site-media";
import { DiveSiteFieldGuide } from "./DiveSiteFieldGuide";
import { DiveSiteLandmarks } from "./DiveSiteLandmarks";
import { DiveSiteMap } from "./DiveSiteMap";

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
}: {
  diveNumber: number;
  title: string | null;
  description: string | null;
  site: Site | null;
  creatures: Creature[];
  moments: Moment[];
}) {
  const heading = title || site?.name || `Dive ${diveNumber}`;
  const landmarks = site ? buildDiveSiteLandmarks(site.name, site.landmarks) : [];

  return (
    <article className="w-[min(90vw,42rem)] shrink-0 snap-center self-start overflow-hidden rounded-2xl border border-border bg-surface sm:w-full">
      {site && getSeedDiveSiteMap(site.name) ? (
        <DiveSiteMap siteName={site.name} />
      ) : site?.satelliteImageUrl ? (
        // biome-ignore lint/performance/noImgElement: staff-provided media supports arbitrary approved hosts.
        <img
          src={site.satelliteImageUrl}
          alt={`Satellite view of ${site.name}`}
          className="h-56 w-full object-cover"
        />
      ) : null}
      <div className="p-5 sm:p-6">
        <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
          Dive {diveNumber}
        </p>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h3>
        {site?.locationName ? <p className="mt-1 text-sm text-muted">{site.locationName}</p> : null}
        {description || site?.description ? (
          <p className="mt-4 leading-relaxed text-muted">{description || site?.description}</p>
        ) : (
          <p className="mt-4 text-muted">The crew will brief the final route at the dock.</p>
        )}
        {site && (site.difficulty || site.depthRange || site.currentNote) ? (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                Experience
              </dt>
              <dd className="mt-1 font-semibold capitalize">{site.difficulty ?? "Crew-led"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">Depth</dt>
              <dd className="mt-1 font-semibold">{site.depthRange ?? "Varies"}</dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs font-medium tracking-widest text-muted uppercase">
                Water movement
              </dt>
              <dd className="mt-1 text-sm font-medium">
                {site.currentNote ?? "Confirmed at the dock"}
              </dd>
            </div>
          </dl>
        ) : null}
        {site?.divePlan ? (
          <section className="mt-7">
            <h4 className="font-semibold">How the dive unfolds</h4>
            <p className="mt-2 leading-relaxed text-muted">{site.divePlan}</p>
          </section>
        ) : null}
        <DiveSiteLandmarks landmarks={landmarks} />
        {site ? (
          <DiveSiteFieldGuide
            creatures={creatures}
            summary={site.marineLifeDescription}
            highlights={site.marineLife}
          />
        ) : null}
        {moments[0] ? (
          <figure className="mt-6 overflow-hidden rounded-lg bg-accent/10 sm:grid sm:grid-cols-[12rem_1fr]">
            {moments[0].imageUrl ? (
              // biome-ignore lint/performance/noImgElement: moderated dive-site media supports approved external hosts.
              <img
                src={resolveDiveSiteImageUrl(moments[0].imageUrl) ?? undefined}
                alt={`A recent diver moment at ${site?.name ?? heading}`}
                className="aspect-video h-full w-full object-cover sm:aspect-square"
              />
            ) : null}
            <figcaption className="p-4 sm:self-center">
              <h4 className="font-semibold">A recent diver moment</h4>
              <p className="mt-1 text-sm text-muted">{moments[0].caption}</p>
            </figcaption>
          </figure>
        ) : null}
      </div>
    </article>
  );
}
