import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingNav, MarketingNavFallback } from "@/components/MarketingNav";
import { SwitchingConcierge } from "@/components/SwitchingConcierge";
import { SwitchingImportCta } from "@/components/SwitchingImportCta";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { sharedLinkCard } from "@/lib/marketing";
import {
  ClosingCta,
  DividedList,
  GuideContext,
  GuideHero,
  ImportPhase,
  MidCta,
  MovePath,
  MovePhase,
  ScopePhase,
} from "../_components/guide";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * "Coming from a spreadsheet" — the front door for the largest, most
 * under-served pool in the market: shops running the whole day on a spreadsheet
 * (and a clipboard). It sits under /switching with the incumbent guides, but it
 * is deliberately NOT one of them: a spreadsheet is not a vendor to leave, so
 * there is no incumbent to describe, no export click-path to reverse-engineer,
 * and no `sources`. The wedge here is not portability (they were never locked
 * in) — it is the things a spreadsheet cannot do: re-check a card at the dock,
 * run the day's blocker queue, let a diver book and sign without an account.
 *
 * Because that framing diverges from the incumbent template, this is its own
 * static route rather than a `migration-guides.ts` entry; a static segment wins
 * over the sibling `[competitor]` dynamic segment for this exact path. The one
 * shared invariant is honesty: the "what comes across" table renders
 * IMPORT_HONESTY_TABLE verbatim, the same source the importer and every
 * incumbent guide use, so the promise and the running code cannot drift.
 *
 * What it *does* share with the incumbent guides is its shape. Both pages were
 * nine sections of the same card grids, duplicated file to file; both now
 * render the one guided path in `../_components/guide` — you're here, what
 * changes, how the move works, what comes across, a person, act — so the only
 * thing that differs between a spreadsheet shop's page and an EVE shop's is
 * what is genuinely different about them. This one has three phases on the
 * move rail rather than four: there is no incumbent to cut over from, so the
 * shared cutover section would be answering a question nobody here asked.
 *
 * The concierge switch offer is a service commitment authorized by the product
 * owner (docs/product/marketing.md, claims policy) — not a product feature. It
 * is the shared `SwitchingConcierge` block, routed to the switch@dive.day inbox,
 * so a shop has a real handoff (in and out) on every switching page, not just
 * the self-service importer and export.
 */

export const metadata: Metadata = {
  title: "Move your dive shop off spreadsheets — DiveDay",
  description:
    "Running your dive shop from a spreadsheet? DiveDay reads the sheet you already keep — your divers, their cards, and their sizes — and adds the things a spreadsheet can't: readiness checked at the dock, the day's blocker queue, and booking and waivers your divers do themselves.",
  alternates: { canonical: "/switching/spreadsheet" },
  // This page shipped without the Open Graph block every sibling guide carries,
  // so the guide aimed at the largest under-served pool in the market was the
  // one unfurling as a bare URL in exactly the chat groups it is written for.
  openGraph: {
    ...sharedLinkCard,
    title: "Move your dive shop off spreadsheets — DiveDay",
    description:
      "Bring the sheet you already keep — divers, cards, sizes — and add what a spreadsheet can't: readiness checked at the dock, the day's blocker queue, and booking and waivers your divers do themselves.",
    url: "/switching/spreadsheet",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy.
  twitter: {
    card: "summary_large_image",
    title: "Move your dive shop off spreadsheets — DiveDay",
    description:
      "Bring the sheet you already keep — divers, cards, sizes — and add what a spreadsheet can't: readiness checked at the dock, the day's blocker queue, and booking and waivers your divers do themselves.",
  },
};

export default function SpreadsheetSwitchPage() {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <Suspense fallback={<SpreadsheetBody locale={DEFAULT_DIVER_LOCALE} importCta={null} />}>
        <LocalizedSpreadsheetBody />
      </Suspense>
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

async function LocalizedSpreadsheetBody() {
  const locale = await requestLocale();
  const t = diverTranslator(locale);
  return (
    <SpreadsheetBody
      locale={locale}
      importCta={<SwitchingImportCta label={t("switching.common.openImportCta")} />}
    />
  );
}

/** The columns the importer recognizes, in the owner's own words. */
const SHEET_COLUMNS = [
  "name",
  "email",
  "phone",
  "emergencyContact",
  "diveInsurance",
  "certification",
  "refresherDue",
  "specialty",
  "nitrox",
  "rentalSizes",
  "pastVisits",
] as const;

/** The four jobs a spreadsheet has no way to hold — this guide's whole wedge. */
const WEDGE_ITEMS = [
  "cardsChecked",
  "blockersOnePlace",
  "diversBookThemselves",
  "manifestHeadCount",
] as const;

/**
 * Cached per negotiated locale (DIVER_LOCALES — two entries). `importCta` carries
 * {@link SwitchingImportCta} (session-scoped — reads `auth()`) as a
 * pass-through slot per Next's `"use cache"` interleaving rules: it is never
 * read or invoked here, only rendered where it belongs in the tree, so its
 * per-visitor content never enters the cache entry.
 *
 * Its render site (`ImportPhase`) wraps `{importCta}` in its own `<Suspense>` —
 * see the same fix on the `[competitor]` guide's `GuideBody` for why: without
 * it, this preview's Cache Components runtime replayed a spurious "unique key"
 * warning on every request.
 */
async function SpreadsheetBody({
  locale,
  importCta,
}: {
  locale: DiverLocale;
  importCta: ReactNode;
}) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  return (
    <main className="flex-1">
      <GuideHero
        locale={locale}
        source="switching-spreadsheet"
        eyebrow={t("switching.spreadsheet.eyebrow")}
        title={t("switching.spreadsheet.title")}
        lede={t("switching.spreadsheet.heroLede")}
      />

      {/* What changes. The two paragraphs set up the trade and the second one
          ends in a colon, so the four jobs are that sentence's own list rather
          than a second band of cards under a second heading. */}
      <GuideContext
        locale={locale}
        paragraphs={[
          t("switching.spreadsheet.wedgeIntro1"),
          t("switching.spreadsheet.wedgeIntro2"),
        ]}
      >
        <DividedList
          items={WEDGE_ITEMS.map((item) => ({
            title: t(`switching.spreadsheet.wedge.${item}.title`),
            detail: t(`switching.spreadsheet.wedge.${item}.body`),
          }))}
        />
      </GuideContext>

      <MidCta locale={locale} source="switching-spreadsheet" />

      {/* The whole mechanical path, as one rail: ready your own sheet → the
          importer's own scope table, verbatim → the importer. */}
      <MovePath locale={locale}>
        <MovePhase
          number={1}
          title={t("switching.spreadsheet.columnsTitle")}
          intro={t("switching.spreadsheet.columnsIntro")}
        >
          <div className="mt-6">
            <a
              href="/diveday-diver-import-template.csv"
              download
              className={buttonClass({ variant: "secondary", className: "border-border-strong" })}
            >
              {t("switching.spreadsheet.downloadTemplate")}
            </a>
          </div>
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {SHEET_COLUMNS.map((column) => (
              <li
                key={column}
                className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:items-baseline sm:gap-4"
              >
                <span className="font-medium text-foreground">
                  {t(`switching.spreadsheet.columns.${column}.column`)}
                </span>
                <span className="text-sm leading-6 text-muted">
                  {t(`switching.spreadsheet.columns.${column}.detail`)}
                </span>
              </li>
            ))}
          </ul>
        </MovePhase>
        <ScopePhase locale={locale} number={2} />
        <ImportPhase locale={locale} number={3} importCta={importCta} />
      </MovePath>

      {/* The owner-authorized concierge switch offer (shared across /switching). */}
      <SwitchingConcierge locale={locale} />

      <ClosingCta
        locale={locale}
        source="switching-spreadsheet"
        title={t("switching.spreadsheet.closingTitle")}
        body={t("switching.spreadsheet.closingDescription")}
        backLabel={t("switching.spreadsheet.otherSystems")}
      />
    </main>
  );
}
