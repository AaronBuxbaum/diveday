import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { StoredPhoto } from "@/components/StoredPhoto";
import { SectionCard } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { TripSitePeek } from "@/db/trips";
import { diveSiteDifficultyLabel } from "@/i18n/dive-site-labels";
import type { DiverTranslator } from "@/i18n/messages";

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
  t,
}: {
  sites: TripSitePeek[];
  heading: string;
  subheading?: string;
  /** A site's difficulty is a code now, so this grid needs the words for it. */
  t: DiverTranslator;
}) {
  if (sites.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className={SECTION_TITLE_CLASS}>{heading}</h2>
      {subheading ? <p className="mt-1 text-sm text-muted">{subheading}</p> : null}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {sites.map((site) => (
          // A shell, not a padded card: the photo runs to the card's edge and
          // the text block below it does its own padding.
          <SectionCard as="article" key={site.name} padding="none" className="overflow-hidden">
            {site.imageUrls && site.imageUrls.length > 0 ? (
              <StoredPhoto
                src={site.imageUrls[0]}
                alt={site.name}
                className="h-32 w-full"
                // One card per row on a phone, two from `sm:grid-cols-2` up.
                sizes="(min-width: 640px) 50vw, 100vw"
              />
            ) : (
              <div className="flex h-32 w-full items-center justify-center bg-surface-sunken text-primary">
                <DiveDayIcon name="diveSites" className="size-10" />
              </div>
            )}
            <div className="p-4">
              <h3 className="font-bold text-base">{site.name}</h3>
              {(() => {
                const difficulty = diveSiteDifficultyLabel(site.difficultyLevel, t);
                if (!site.depthRange && !difficulty) return null;
                return (
                  <p className="text-xs font-semibold text-primary mt-0.5">
                    {site.depthRange ?? ""}
                    {site.depthRange && difficulty ? " · " : ""}
                    {difficulty ?? ""}
                  </p>
                );
              })()}
              {site.description && (
                <p className="mt-2 text-sm text-muted line-clamp-3">{site.description}</p>
              )}
            </div>
          </SectionCard>
        ))}
      </div>
    </section>
  );
}
