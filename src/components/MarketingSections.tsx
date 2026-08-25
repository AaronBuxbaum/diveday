import type { ReactNode } from "react";
import {
  CaptainRollCallFallback,
  DiverBookingFallback,
  FrontDeskReadinessFallback,
} from "@/components/MarketingScreenFallbacks";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { productFeatureGroups } from "@/lib/marketing";

/**
 * Shared marketing rendering used by the landing, product, and pricing pages so
 * they always describe the same product with the same components.
 *
 * The public pages ship deterministic illustrated mockups (the `*Fallback`
 * components) as the design. `MarketingMockup` preserves the framing the old
 * `MarketingScreenshot` fallback branch provided: an accessible `role="img"`
 * with an `aria-label`, plus the rounded bordered surface.
 *
 * **Neither panel in this file is a `SectionCard`, deliberately.**
 * `MarketingMockup` is a *device frame* rather than a section of a page: it is
 * a `role="img"`, it clips its contents (`overflow-hidden`), and
 * `CaptainPhoneFrame` overrides its radius and removes its border outright to
 * sit inside a phone bezel — three things the canonical card has no prop for
 * and should not grow one for. `FeatureGroupsGrid`'s cards are `bg-background`
 * because they render on a `bg-surface` band on the homepage, and `SectionCard`
 * hard-codes `bg-surface`; passing a second background utility through
 * `className` would be resolved by stylesheet order rather than by intent.
 * Converting that one is a decision in `src/components/ui/card.tsx` about what
 * a card on a surface band is, not a call-site override here.
 */
export function MarketingMockup({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`overflow-hidden rounded-2xl border border-border bg-surface text-left ${className}`}
    >
      {children}
    </div>
  );
}

/** The captain roll-call mockup inside a phone device frame (landing hero + product dock). */
export function CaptainPhoneFrame({
  label,
  locale,
  className = "",
}: {
  label: string;
  locale: DiverLocale;
  className?: string;
}) {
  return (
    <div
      className={`marketing-roll-call-frame rounded-[2.5rem] border-[9px] border-device-frame bg-device-frame p-1.5 shadow-2xl shadow-device-frame/20 ${className}`}
    >
      <div className="mx-auto mb-1.5 h-1.5 w-20 rounded-full bg-muted/50" />
      <MarketingMockup label={label} className="rounded-[1.9rem] border-0">
        <CaptainRollCallFallback locale={locale} />
      </MarketingMockup>
    </div>
  );
}

/**
 * Only the illustration — never a `label`, which the caller must resolve
 * through a translator (see `marketing.home.moments.*.mockupLabel` and
 * `MarketingMockup`'s own `aria-label`).
 */
export const marketingMockups = {
  diverBooking: { render: (locale: DiverLocale) => <DiverBookingFallback locale={locale} /> },
  frontDeskReadiness: {
    render: (locale: DiverLocale) => <FrontDeskReadinessFallback locale={locale} />,
  },
} as const;

/**
 * The `productFeatureGroups` grid rendered on landing and pricing: four cards,
 * each an eyebrow, a heading and one summary paragraph.
 *
 * **One density, deliberately.** This grid used to take `featuresPerGroup` and
 * branch between a checklist of `✓` bullets and a paragraph. `/product` was the
 * only caller that ever asked for the checklist, and when its middle density
 * was removed on 2026-08-13 the branch became unreachable — leaving 26
 * translated claims in two locales that no page could render. The checklist and
 * the prop are gone; the full inventory lives on `/product` as
 * `productCapabilityIndex`, which is the density a buyer came for.
 *
 * The `columns` prop went the same way and for the same reason: pricing had
 * already dropped this grid, so the two-column branch had no caller either.
 * One caller, one width — if a second page wants a narrower grid, the prop
 * comes back then, with a page behind it.
 *
 * The groups arrive as message keys (src/lib/marketing.ts holds structure, not
 * words), so the caller passes the negotiated `locale` and the words resolve
 * here.
 */
export function FeatureGroupsGrid({ locale }: { locale: DiverLocale }) {
  const t = diverTranslator(locale);

  return (
    // **An ordered list, because the four groups are a sequence.** They are the
    // phases of one shop's day in the order it happens — welcome a diver, get
    // them ready, run the day, hand it off — and the old rendering as four equal
    // boxes threw that away, leaving the band to *assert* breadth where it could
    // have shown it. Numbering them is the whole visual idea: it costs no copy,
    // adds the one thing four assertions could not say on their own, and reads
    // as a track rather than a shelf (product owner, 2026-08-20 — keep the
    // cards, make them more visual, and not with a photograph).
    //
    // `<ol>` rather than a div of articles so the sequence is real for a screen
    // reader too, not just a drawn effect.
    //
    // Four columns wait for `xl`: at 1024 the ~226px cards wrapped their
    // uppercase eyebrows onto two lines and knocked the four headings onto
    // three different baselines — a comfortable 2×2 reads calmer there.
    <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {productFeatureGroups.map((group, index) => (
        <li
          key={group.eyebrow}
          className="relative rounded-2xl border border-border bg-background p-5 shadow-sm sm:p-6"
        >
          {/* The rule that turns four cards into one track. Only at `xl`, where
              the four genuinely sit on one row — at `sm` the 2×2 would have it
              pointing at nothing — and never off the last card, which would
              trail into the margin. `gap-4` is 1rem, so `w-4` closes exactly
              the gutter. */}
          {index < productFeatureGroups.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-10 left-full hidden h-px w-4 bg-border xl:block"
            />
          ) : null}
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-primary-tint text-sm font-semibold text-primary tabular-nums"
          >
            {index + 1}
          </span>
          <p className="mt-4 text-xs font-semibold tracking-widest text-primary uppercase">
            {t(group.eyebrow)}
          </p>
          <h3 className="mt-3 font-semibold leading-6">{t(group.title)}</h3>
          <p className="mt-3 text-sm leading-6 text-muted">{t(group.summary)}</p>
        </li>
      ))}
    </ol>
  );
}
