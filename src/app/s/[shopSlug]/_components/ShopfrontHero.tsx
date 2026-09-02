import { StarRating } from "@/components/StarRating";
import { StoredPhoto } from "@/components/StoredPhoto";
import type { DiverTranslator } from "@/i18n/messages";
import type { BrandBadgeCode } from "@/lib/brand";
import {
  type ConservationCommitmentCode,
  conservationCommitmentLabel,
} from "@/lib/conservation-commitments";
import { cachedFormatter } from "@/lib/intl-cache";
import type { ReviewAggregate } from "@/lib/reviews";
import { BadgeWall } from "./BadgeWall";

/**
 * **The shopfront's identity band** — ADR
 * 20260827-clearwater-surface-language, decision 8: the public schedule leads
 * with the shop, not with the word "Schedule".
 *
 * The page used to open on a `text-2xl` h1 reading "Schedule" over a DiveDay
 * sentence about finding your next day on the water, with the shop's own
 * conservation claims in a bordered card beneath it. A diver comparing three
 * Key Largo shops in three tabs read the identical masthead in all three.
 *
 * **The one rule this component must not drift from: it renders only what the
 * shop authored.** The name is always there; the tagline line only when
 * `shops.tagline` is set; the rating line only once divers have actually left
 * one; the conservation line only when the shop ticked something. There is no
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
 */
export function ShopfrontHero({
  name,
  tagline,
  description = null,
  aggregate,
  commitments,
  heroImage = null,
  badges = [],
  establishedYear = null,
  locale,
  t,
}: {
  name: string;
  /** The shop's cover photograph (Harbor); the name and tagline sit on it. */
  heroImage?: { url: string; alt: string } | null;
  /** The badge wall, in the shop's order (Harbor). */
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
  /** Every commitment the shop ticked, in the canonical order. */
  commitments: readonly ConservationCommitmentCode[];
  /** The negotiated request locale — a 4.3 is "4,3" to half the divers reading it. */
  locale: string;
  t: DiverTranslator;
}) {
  const average = aggregate && aggregate.count > 0 ? aggregate.average : null;
  return (
    <div className="min-w-0">
      {/* Headings wear the shop's display face (Harbor — ADR
          20260901-diveday-reimagined, decision 2); every fact beneath stays in
          Geist and ink, so the face can never label a rating, a count or a claim. */}
      {heroImage ? (
        <div className="relative mb-6 overflow-hidden rounded-panel border border-border bg-surface-sunken shadow-bed">
          <StoredPhoto
            src={heroImage.url}
            alt={heroImage.alt}
            className="aspect-[16/7] w-full"
            sizes="(min-width: 1152px) 1152px, 100vw"
            priority
          />
          {/* Paper on a scrim of ink, whatever the photograph: legibility does
              not depend on the shop choosing a dark picture. */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-device-frame/85 via-device-frame/45 to-transparent px-5 pt-16 pb-5 text-surface sm:px-8 sm:pb-7">
            <h1 className="font-brand-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {name}
            </h1>
            {tagline ? <p className="mt-2 max-w-2xl text-lg text-pretty">{tagline}</p> : null}
          </div>
        </div>
      ) : (
        <>
          <h1 className="font-brand-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
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
          </span>
          <span className="tabular-nums">
            {" · "}
            {t("reviews.count", { count: aggregate.count })}
          </span>
        </p>
      )}
      <BadgeWall badges={badges} establishedYear={establishedYear} t={t} className="mt-4" />
      {commitments.length > 0 ? (
        <p className="mt-3 flex max-w-2xl items-start gap-2 text-sm text-muted">
          <ReefGlyph />
          <span>
            {commitments.map((code) => conservationCommitmentLabel(code, t)).join(" · ")}{" "}
            {/* Never deleted, never softened: it is what keeps a list of
                unverified claims from reading as DiveDay vouching for them. */}
            <span>{t("conservation.shopClaimsDisclaimer")}</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** One drawn mark for the whole conservation line — a coral head, in the line's own muted ink. */
function ReefGlyph() {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="mt-0.5 size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 17V9M10 9c0-3-3-4-3-4M10 9c0-3 3-4 3-4M10 13c-2-1-4-2-4-2M10 13c2-1 4-2 4-2" />
      <path d="M3 17h14" />
    </svg>
  );
}
