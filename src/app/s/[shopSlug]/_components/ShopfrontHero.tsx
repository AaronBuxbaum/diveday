import { StarRating } from "@/components/StarRating";
import { StoredPhoto } from "@/components/StoredPhoto";
import { PAGE_TITLE_CLASS } from "@/components/ui/typography";
import type { DiverTranslator } from "@/i18n/messages";
import type { BrandBadgeCode } from "@/lib/brand";
import { cachedFormatter } from "@/lib/intl-cache";
import type { ReviewAggregate } from "@/lib/reviews";
import { BadgeWall } from "./BadgeWall";

/**
 * **The shopfront's identity band** — ADR
 * 20260827-clearwater-surface-language, decision 8: the public schedule leads
 * with the shop, not with the word "Schedule".
 *
 * The page used to open on a `text-2xl` h1 reading "Schedule" over a DiveDay
 * sentence about finding your next day on the water. A diver comparing three
 * Key Largo shops in three tabs read the identical masthead in all three.
 *
 * **The one rule this component must not drift from: it renders only what the
 * shop authored.** The name is always there; the tagline line only when
 * `shops.tagline` is set; the rating line only once divers have actually left
 * one. There is no
 * DiveDay filler for the empty version of any of them — a hero apologising for
 * a shop that has not written a tagline yet is worse than a hero that is simply
 * shorter, and day zero (a name, and nothing else) is a real shipping shape
 * rather than a failure state.
 *
 * Contact is deliberately **not** here: phone, email and address live once, in
 * `PublicShopFooter`, and hoisting them turned the top of every public page
 * into a contact card (issue #777).
 *
 * The stars are the page's one accent — decision 11's coral budget, where a
 * filled rating star is data ink, counts as one appearance however many are
 * lit, and never fires beside an earned moment (the storefront has none).
 *
 * **The band is the shop's photograph or nothing** — ADR 20260919-one-idea,
 * slice 23d, as ADR 20261001-logbook left it. A shop with a cover photo gets
 * its name on the photograph; a shop without one gets its name on the page's
 * own surface. The sky that once filled a photo-less band is gone.
 */
export function ShopfrontHero({
  name,
  tagline,
  description = null,
  aggregate,
  heroImage = null,
  badges = [],
  establishedYear = null,
  beside = false,
  locale,
  t,
}: {
  name: string;
  /**
   * The next-boat card shares the row from `lg` up, so the photograph is the
   * narrower column there and asks for a smaller file.
   */
  beside?: boolean;
  /** The shop's cover photograph; the name and tagline sit on it. */
  heroImage?: { url: string; alt: string } | null;
  /** The badge wall, in the shop's order. */
  badges?: readonly BrandBadgeCode[];
  establishedYear?: number | null;
  /** `shops.tagline` — the shop's own line, or nothing at all. */
  tagline: string | null;
  /**
   * `shops.description` — the shop's own paragraph about itself, authored in
   * Settings and, until 2026-09-02, read by nothing but the page's metadata.
   * It is the storefront's "about", under the name, or nothing at all.
   */
  description?: string | null;
  /** Rendered only at `count > 0`; a shop with no reviews says nothing about reviews. */
  aggregate: ReviewAggregate | null;
  /** The negotiated request locale — a 4.3 is "4,3" to half the divers reading it. */
  locale: string;
  t: DiverTranslator;
}) {
  const average = aggregate && aggregate.count > 0 ? aggregate.average : null;
  return (
    <div className="min-w-0">
      {/* Headings wear the shop's display face (Harbor — ADR
          20260901-diveday-reimagined, decision 2); every fact beneath stays in
          Plex and ink, so the face can never label a rating, a count or a claim. */}
      {heroImage ? (
        <div className="mb-6 overflow-hidden rounded-panel border border-border bg-surface-sunken shadow-bed">
          <StoredPhoto
            src={heroImage.url}
            alt={heroImage.alt}
            // 16:9 on a phone, so the picture still reads as a picture above
            // the band; 16:7 from `sm` up, and 2:1 from `lg` when it shares
            // the row with the next boat and a narrower column would make
            // 16:7 a letterbox.
            className={`aspect-video w-full sm:aspect-[16/7] ${beside ? "lg:aspect-[2/1]" : ""}`}
            sizes={
              beside
                ? "(min-width: 1152px) 760px, (min-width: 1024px) 62vw, 100vw"
                : "(min-width: 1152px) 1152px, 100vw"
            }
            priority
          />
          {/* Paper on a flat band of solid ink under the photograph, whatever
              the picture: legibility does not depend on the shop choosing a
              dark one. Opaque and below the photo rather than a fade over it
              (ADR 20261001-logbook: no gradients), so the name reads at the
              ink's own contrast and a two-line name on a phone does not bury
              the picture it sat on. */}
          <div className="bg-device-frame px-5 py-4 text-device-frame-foreground sm:px-8 sm:py-5">
            <h1 className={`font-brand-display ${PAGE_TITLE_CLASS} text-balance sm:text-5xl`}>
              {name}
            </h1>
            {tagline ? <p className="mt-2 max-w-2xl text-lg text-pretty">{tagline}</p> : null}
          </div>
        </div>
      ) : (
        <>
          <h1 className={`font-brand-display ${PAGE_TITLE_CLASS} text-balance sm:text-5xl`}>
            {name}
          </h1>
          {tagline ? <p className="mt-3 max-w-2xl text-lg text-pretty">{tagline}</p> : null}
        </>
      )}
      {description ? (
        <p className="mt-4 max-w-2xl text-base text-pretty text-foreground/90">{description}</p>
      ) : null}
      {average === null || !aggregate ? null : (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
          <StarRating
            rating={Math.round(average)}
            label={t("reviews.ratingOption", { rating: Math.round(average) })}
            tone="accent"
            className="text-base"
          />
          {/* The number leads as a figure rather than as another line of small
              muted text (decision 3), and it is formatted for the reader's own
              locale — "4,3" to half the divers who read it. */}
          <span className="text-base font-semibold text-foreground tabular-nums">
            {cachedFormatter("num", Intl.NumberFormat, locale, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            }).format(average)}
          </span>{" "}
          {/* The dot is a fragment of its own, so the row's gap falls evenly
              either side of it; the spaces are for anything reading the text,
              and a flex row renders none of them. */}
          <span aria-hidden="true">·</span>{" "}
          <span className="tabular-nums">{t("reviews.count", { count: aggregate.count })}</span>
        </p>
      )}
      <BadgeWall badges={badges} establishedYear={establishedYear} t={t} className="mt-4" />
    </div>
  );
}
