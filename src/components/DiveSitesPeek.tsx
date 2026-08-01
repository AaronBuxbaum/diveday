import { StoredPhoto } from "@/components/StoredPhoto";
import type { TripSitePeek } from "@/db/trips";

/**
 * "Here's what you'll explore" — a small photo/fact grid for a trip's dive
 * sites, shared by every diver-facing page that wants to bring anticipation
 * to a booking (the waiver success page and `/ready`) so the two never
 * render two different takes on the same trip's site list.
 */
export function DiveSitesPeek({
  sites,
  heading,
  subheading,
}: {
  sites: TripSitePeek[];
  heading: string;
  subheading: string;
}) {
  if (sites.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <p className="mt-1 text-sm text-muted">{subheading}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {sites.map((site) => (
          <div
            key={site.name}
            className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
          >
            {site.imageUrls && site.imageUrls.length > 0 ? (
              <StoredPhoto
                src={site.imageUrls[0]}
                alt={site.name}
                className="h-32 w-full"
                // One card per row on a phone, two from `sm:grid-cols-2` up.
                sizes="(min-width: 640px) 50vw, 100vw"
              />
            ) : (
              <div className="h-32 w-full bg-surface-sunken flex items-center justify-center text-3xl">
                🐠
              </div>
            )}
            <div className="p-4">
              <h3 className="font-bold text-base">{site.name}</h3>
              {(site.depthRange || site.difficulty) && (
                <p className="text-xs font-semibold text-primary mt-0.5">
                  {site.depthRange ? `${site.depthRange}` : ""}
                  {site.depthRange && site.difficulty ? " · " : ""}
                  {site.difficulty ? `${site.difficulty}` : ""}
                </p>
              )}
              {site.description && (
                <p className="mt-2 text-sm text-muted line-clamp-3">{site.description}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
