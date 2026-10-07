import Link from "next/link";
import type { ReactNode } from "react";
import { CaptainRollCallFallback } from "@/components/MarketingScreenFallbacks";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { groupLabelClass } from "@/components/ui/ledger";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { FEATURE_PHASES, featurePagePath, featurePagesIn } from "@/lib/feature-pages";
import { type CapabilityGroupId, capabilityGroup, hubOnlyCapabilityGroups } from "@/lib/marketing";

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
 * `CaptainPhoneFrame` draws it as a `screen` — a corner concentric with a phone
 * bezel and no border — three things the canonical card has no prop for and
 * should not grow one for. `FeatureDirectory` draws no panel at all: it is a
 * table of contents, rows between hairlines, so it reads the same on the
 * homepage's `bg-surface` band and on the hub's page background.
 */
/**
 * The phone `CaptainPhoneFrame` draws: a 2.5rem corner, a 9px frame, and
 * `p-1.5` between the frame and the screen. The screen's corner below is
 * spelled from these three values, so change one here and re-derive it there;
 * `MarketingSections.test.tsx` fails until you do.
 */
const PHONE_BEZEL = "rounded-[2.5rem] border-[9px] p-1.5";

/**
 * The two frames a mockup is drawn in — chosen, never overridden. Each names
 * its one corner, and no caller passes a corner, a border or a shadow through
 * `className`, because two utilities for one property on one element resolve
 * by the order Tailwind emits them, not by intent: the phone passed
 * `rounded-[1.9rem] border-0` beside the panel's `rounded-panel border`, and
 * the panel's corner won where the bezel nests one at 25px (pixel-craft class
 * 6, K-295). Neither frame lifts: Logbook sets a screen off by its hairline,
 * not a shadow (ADR 20261001-logbook, decision 5). `MarketingSections.test.tsx`
 * holds both lines.
 */
const MOCKUP_FRAME = {
  /** A screen on a page: the panel rung and one hairline. */
  panel: "rounded-panel border border-border",
  /**
   * The screen inside `PHONE_BEZEL`. No hairline, because the bezel is its
   * edge, and a corner that runs parallel to the bezel's: its corner less its
   * frame and its padding, 40 − 9 − 6 = 25px at a 16px root, written as that
   * subtraction so the two curves move together at any root size, as
   * `PANEL_INNER_RADIUS` and `SEGMENT_CORNER` are.
   */
  screen: "rounded-[calc(2.5rem-9px-var(--spacing)*1.5)]",
} as const;

export function MarketingMockup({
  label,
  children,
  frame = "panel",
  className = "",
}: {
  label: string;
  children: ReactNode;
  frame?: keyof typeof MOCKUP_FRAME;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`overflow-hidden ${MOCKUP_FRAME[frame]} bg-surface text-left ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * The captain roll-call mockup inside a phone device frame: the homepage and
 * `/about` heroes, and the boat manifest feature page's screen.
 */
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
      className={`marketing-roll-call-frame ${PHONE_BEZEL} border-device-frame bg-device-frame ${className}`}
    >
      <div className="mx-auto mb-1.5 h-1.5 w-20 rounded-full bg-muted/50" />
      <MarketingMockup label={label} frame="screen">
        <CaptainRollCallFallback locale={locale} />
      </MarketingMockup>
    </div>
  );
}

/**
 * The builder's notes beside a screen: the register the public pages speak
 * in since the 2026-09-24 voice decision (docs/design/brand.md, "The voice on
 * the public pages"). A numbered list, each item one note under twenty words
 * that names a thing visible on the mockup next to it and gives its reason or
 * its limit. The number is the anchor a reader's eye carries from the note to
 * the screen, which is why it is set in the primary colour rather than muted
 * like a body list's.
 *
 * Structure only: the notes arrive resolved from the bundle, because the same
 * list renders on `/`, on every feature page and on the switching and pricing
 * pages, and none of them may spell a note inline.
 */
export function MarginNotes({
  notes,
  className = "",
}: {
  notes: readonly string[];
  className?: string;
}) {
  return (
    <ol className={`space-y-3 text-sm leading-6 text-muted ${className}`}>
      {notes.map((note, index) => (
        <li key={note} className="flex gap-3">
          <span className="w-4 shrink-0 font-semibold text-primary tabular-nums">{index + 1}</span>
          <span>{note}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Every feature page, listed under the part of a shop's year it serves: what
 * happens before a diver arrives, on the dive day, and across the season
 * (`FEATURE_PHASES`). Each row is the page's name and its one-sentence summary,
 * and the whole row is the link, so a reader scanning for "waivers" lands on
 * the waivers page in one tap.
 *
 * **The homepage and the hub render the same directory**, which is the point:
 * the registry in `src/lib/feature-pages.ts` is the one list of pages, and a
 * page added there appears on both without either page naming it. It replaced
 * `FeatureGroupsGrid`'s four summary cards (2026-10-05), which described the
 * product in four paragraphs and linked nowhere.
 *
 * **On the hub the directory is also the full list** (`lines`). Each row
 * carries a disclosure under the link, counted, holding that page's "What's in
 * it" checklist (its group of `productCapabilityIndex`, word for word), and
 * the three groups no single page owns (the diver record, running the shop,
 * your records) follow the phases as rows of their own. Until review on
 * 2026-10-05 the hub listed the same twelve names twice, the directory and
 * then a spec sheet one band down; now there is one list, and every line is
 * still on the page for find-in-page (Chromium and Firefox open a closed
 * `<details>` to reveal a match). The homepage only routes, so it draws the
 * rows without them.
 *
 * `headingLevel` follows the page: the phases sit under the homepage's band
 * heading (`h3`), and are the hub's own sections (`h2`).
 */
export function FeatureDirectory({
  locale,
  headingLevel = "h3",
  lines = false,
}: {
  locale: DiverLocale;
  headingLevel?: "h2" | "h3";
  lines?: boolean;
}) {
  const t = diverTranslator(locale);
  const Heading = headingLevel;

  return (
    <div className="grid gap-x-10 gap-y-12 lg:grid-cols-3">
      {FEATURE_PHASES.map((phase) => (
        <div key={phase}>
          <Heading className={groupLabelClass("primary")}>
            {t(`marketing.featureChrome.phases.${phase}`)}
          </Heading>
          <ul className="mt-4 border-t border-border">
            {featurePagesIn(phase).map((page) => (
              <li key={page.slug} className="border-b border-border">
                <Link
                  href={featurePagePath(page.slug)}
                  className={`group flex flex-col ${lines ? "pt-4" : "py-4"}`}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span
                      id={lines ? pageNameId(page.key) : undefined}
                      className={`${ITEM_TITLE_CLASS} transition-colors group-hover:text-primary`}
                    >
                      {t(`marketing.featurePages.${page.key}.name`)}
                    </span>
                    <DiveDayIcon
                      name="arrow-right"
                      className="size-4 shrink-0 text-muted transition-colors group-hover:text-primary"
                    />
                  </span>
                  <span className="mt-1 text-sm leading-6 text-muted">
                    {t(`marketing.featurePages.${page.key}.summary`)}
                  </span>
                </Link>
                {/* Beside the link, never inside it: a control nested in a
                    link is two targets in one, and the row's link is the
                    page. */}
                {lines ? <CapabilityLines locale={locale} id={page.key} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {lines ? (
        <div className="lg:col-span-3">
          <Heading className={groupLabelClass("primary")}>
            {t("marketing.product.alsoInPlan")}
          </Heading>
          {/* One row per group, in the directory's three columns from `lg`.
              Each row draws its own rules there, because the gutters between
              columns carry none; below `lg` they stack under one top rule. */}
          <ul className="mt-4 grid border-t border-border lg:grid-cols-3 lg:gap-x-10 lg:border-t-0">
            {hubOnlyCapabilityGroups.map((id) => (
              <li key={id} className="border-b border-border lg:border-t">
                <CapabilityLines locale={locale} id={id} titled />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** The id of a hub row's page name, which that row's checklist is named by. */
const pageNameId = (key: CapabilityGroupId) => `feature-${key}-name`;

/**
 * One group of the full list as a native disclosure: closed at rest, counting
 * its lines, every line one tap or one Enter away and still in the page for
 * find-in-page. Under a feature page's row it shows only the count, because the
 * row's link above it already names the page; a screen reader still hears the
 * page's name first (`aria-labelledby`), since a list of controls read out of
 * context would otherwise be twelve counts. `titled` is a row of its own, for
 * a group no page owns, and names the group.
 */
function CapabilityLines({
  locale,
  id,
  titled = false,
}: {
  locale: DiverLocale;
  id: CapabilityGroupId;
  titled?: boolean;
}) {
  const t = diverTranslator(locale);
  const group = capabilityGroup(id);
  const countId = `capabilities-${id}-count`;
  const count = (
    <span className="flex shrink-0 items-center gap-2 text-sm text-muted">
      <span id={countId} className="tabular-nums">
        {t("marketing.product.boxGroupCount", { count: group.items.length })}
      </span>
      <DisclosureCaret direction="down" className="group-open:rotate-180" />
    </span>
  );
  return (
    <details className="group">
      <summary
        aria-labelledby={titled ? undefined : `${pageNameId(id)} ${countId}`}
        className={`flex cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden ${
          titled ? "min-h-14 justify-between gap-4 py-4" : "min-h-11"
        }`}
      >
        {titled ? (
          <>
            <span className={`${ITEM_TITLE_CLASS} text-balance`}>{t(group.title)}</span>
            {count}
          </>
        ) : (
          count
        )}
      </summary>
      <ul className="space-y-1.5 pb-5 text-sm leading-6 text-muted">
        {group.items.map((item) => (
          <li key={item}>{t(item)}</li>
        ))}
      </ul>
    </details>
  );
}
