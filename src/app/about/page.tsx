import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { CaptainPhoneFrame } from "@/components/MarketingSections";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { groupLabelClass } from "@/components/ui/ledger";
import {
  BANNER_TITLE_CLASS,
  MARKETING_EYEBROW_CLASS,
  SUB_TITLE_CLASS,
} from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { switchingHref } from "@/lib/funnel";
import { earlyAccessPrice, fullShopExport, sharedLinkCard } from "@/lib/marketing";
import { SUPPORT_EMAIL, setUpMailto } from "@/lib/platform-mail";

// `instant = true`: navigating here paints immediately. Every request-scoped
// read sits behind a `<Suspense>` boundary — this segment's `loading.tsx`, or
// one placed inside the page — so the frame lands without waiting on the
// request. `next build` audits the claim. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Why DiveDay exists — DiveDay",
  description:
    "The 1998 Great Barrier Reef story behind DiveDay’s roll call, the divers who build it, what every screen is held to, and how a shop gets set up.",
  alternates: { canonical: "/about" },
  openGraph: {
    ...sharedLinkCard,
    title: "Why DiveDay exists — DiveDay",
    description:
      "The story behind DiveDay’s roll call, the divers who build it, and how a shop gets set up.",
    url: "/about",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy.
  twitter: {
    card: "summary_large_image",
    title: "Why DiveDay exists — DiveDay",
    description:
      "The story behind DiveDay’s roll call, the divers who build it, and how a shop gets set up.",
  },
};

/**
 * The body renders **once**, in the reader's own language.
 *
 * Until 2026-08-14 the `<Suspense>` below took `<AboutBody
 * locale={DEFAULT_DIVER_LOCALE} />` — this whole page, a second time, in
 * English — as the fallback for the negotiated-locale one. It bought the
 * instant paint and cost the visitor everything they had done to that subtree
 * first: React carries no DOM state across a replaced subtree, so an `es-ES`
 * reader who reached the support-email or pricing doors mid-page lost the
 * interaction, and for an en-US reader the two renders were the same words, so
 * no screenshot and no English-pinned assertion could see it
 * (FU-20260812-marketing-suspense-swap-discards-interaction; the rule is ADR
 * 20260804-instant-navigation's 2026-08-14 amendment — a fallback holds shape,
 * never interaction).
 *
 * The paint is still instant, and it is this segment's `loading.tsx` that makes
 * it so; nothing in that skeleton is interactive, so there is nothing to lose
 * when the real body lands. The nav keeps its own boundary because it reads the
 * *session* as well as the locale; the body must not wait on that.
 */
export default async function AboutPage() {
  const locale = await requestLocale();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <AboutBody locale={locale} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function AboutBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);

  /**
   * The four things every screen is held to. Each is a shipped behavior a
   * visitor can reproduce in the demo (docs/product/marketing.md,
   * shipped-only). Until 2026-10-07 each card ended in a "Check it:" dare
   * naming the demo action; the 2026-10-07 rewrite dropped the dares with the
   * rest of the spoken register (H-99) and lets the demo door under the grid
   * carry the invitation once.
   *
   * The page speaks as the company. It names no individual, states no CV, and
   * describes the people who build DiveDay in generalities (docs/product/
   * marketing.md, "Biography is a claim like any other", 2026-10-07 amendment);
   * `copy.test.ts` holds the mechanical half of that in both locales.
   */
  const standards = [
    {
      title: t("marketing.about.rules.survivesDock.title"),
      body: t("marketing.about.rules.survivesDock.body"),
    },
    {
      title: t("marketing.about.rules.noSilentPasses.title"),
      body: t("marketing.about.rules.noSilentPasses.body"),
    },
    {
      title: t("marketing.about.rules.onePrice.title"),
      // The figure where the question is raised, never a door away from it.
      // Interpolated, never spelled: `earlyAccessPrice` is H-12's single
      // source, and `src/lib/marketing.test.ts` counts this key among the
      // sentences that must carry `{price}` and `{cadence}`.
      body: t("marketing.about.rules.onePrice.body", {
        price: earlyAccessPrice.price,
        cadence: t(earlyAccessPrice.cadenceKey),
      }),
    },
    {
      title: t("marketing.about.rules.yourRecords.title"),
      // The export terms are the one shared claim (`fullShopExport`), composed
      // here as on every other page that states them, so the card cannot drift
      // from the pricing FAQ or the homepage's records band.
      body: t("marketing.about.rules.yourRecords.body", {
        terms: t(fullShopExport.termsKey),
      }),
    },
  ] as const;

  return (
    <main className="flex-1">
      {/* The hero is why DiveDay exists: the Lonergans, left behind on the
          Great Barrier Reef in 1998 when nobody noticed two divers missing
          (docs/product/marketing.md, "Biography is a claim like any other",
          holds the sourcing and the limits: no operator or skipper named, no
          adjective on the account, no sentence saying DiveDay would have
          prevented it). The right column is the thing that story built, a
          captain's roll call by name, running from the phone's saved copy.

          The eyebrow is the page's `h1`. The display heading over the story
          ("Why did you build this") left on 2026-10-07 at the owner's call, so
          the story is the first thing read and nothing stands over it; the
          page's name stays on the one heading a screen reader lands on first,
          and the story itself is set a step up from body text so the hero
          still has a weight to it. Told flat, in the order it happened: the
          story carries its own weight and the page does not sell with it. */}
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl gap-12 px-6 py-16 lg:grid-cols-[1fr_0.8fr] lg:items-center lg:py-24">
          <div className="max-w-2xl">
            <h1 className={MARKETING_EYEBROW_CLASS}>{t("marketing.about.eyebrow")}</h1>
            <p className="mt-6 max-w-2xl text-xl leading-8 sm:text-2xl sm:leading-9">
              {t("marketing.about.heroDescription")}
            </p>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted">
              {t("marketing.about.heroP2")}
            </p>
          </div>
          <CaptainPhoneFrame
            label={t("marketing.about.phoneFrameLabel")}
            locale={locale}
            className="mx-auto w-full max-w-xs lg:max-w-sm"
          />
        </div>
      </section>

      {/* Who is behind it comes straight after why. The band speaks for the
          company in generalities: people who build software for a living and
          dive, and what each of those puts into the product. */}
      <section className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          {/* Two grid items, so below `lg` the row gap is the heading-to-body
              gap: `gap-5`, the `mt-5` every other band sets its body at, and
              the 40px column gap only once there are columns (K-577). */}
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1fr] lg:items-start lg:gap-10">
            <div>
              <p className={MARKETING_EYEBROW_CLASS}>{t("marketing.about.peopleEyebrow")}</p>
              <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.about.peopleTitle")}
              </h2>
            </div>
            <div className="max-w-2xl space-y-5 text-lg leading-8 text-muted">
              <p>{t("marketing.about.peopleP1")}</p>
              <p>{t("marketing.about.peopleP2")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* What the product is built around, then the four standards as cards,
          then the page's first demo door. The order is why, who, what we hold
          it to, which is the order a reader asks in. */}
      <section className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
        <div className="max-w-2xl">
          <p className={MARKETING_EYEBROW_CLASS}>{t("marketing.about.buildEyebrow")}</p>
          <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
            {t("marketing.about.buildTitle")}
          </h2>
          <p className="mt-4 text-lg leading-8 text-muted">
            {t("marketing.about.buildDescription")}
          </p>
        </div>
        {/* `SectionCard`, so this panel is spelled the same as every other
            bordered panel in the app (one radius, one elevation) instead of a
            fifth hand-typed variant. The heading stays a call-site `h3` at the
            marketing scale rather than going through `title`: the section above
            it is `text-4xl`, and `titleAs="h3"` renders `text-base`, which
            would set the page's standards as fine print under a 36px heading.
            The card's *chrome* is shared; the marketing type scale is not the
            staff one. */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {standards.map((rule) => (
            <SectionCard as="article" key={rule.title} padding="lg">
              <h3 className={SUB_TITLE_CLASS}>{rule.title}</h3>
              <p className="mt-3 leading-7 text-muted">{rule.body}</p>
            </SectionCard>
          ))}
        </div>
        {/* The first demo door sits under the standards, where a reader who
            wants to see them for themselves is (docs/product/
            marketing-review-20260827.md, "help arrives after the homework").
            No words of its own: the four cards above are the caption, and a
            heading here would restate the section it closes. Left-aligned on
            the section's rail, like the heading block and the grid. */}
        <FunnelCtas locale={locale} source="about-rules" className="mt-10" />
        {/* The demo's cost, stated once on this page, at its first door
            (docs/product/marketing.md, "The demo's cost is stated once per
            page, at the first door"). The closing band repeats the door, not
            the note. */}
        <p className="mt-3 text-sm font-medium text-muted">{t("marketing.common.demoNote")}</p>
      </section>

      {/* How a shop gets set up and who answers afterwards, beside the
          commercial facts a buyer scans for: where the records live, how the
          plan works, who answers. The prose argues; the list is the same
          facts at a glance. */}
      <section className="border-t border-border">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div className="max-w-2xl">
              <p className={MARKETING_EYEBROW_CLASS}>{t("marketing.about.workEyebrow")}</p>
              <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.about.workTitle")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">{t("marketing.about.workP1")}</p>
              <p className="mt-4 text-lg leading-8 text-muted">{t("marketing.about.workP2")}</p>
              {/* Three peer doors for the band's three claims — get set up,
                  read the price, see how records move — and no primary among
                  them: the impulse is spent under the standards grid above, so
                  this row stays available and stops shouting
                  (docs/product/marketing-review-20260827.md, `/about`).

                  The first door is the set-up mail, the same one the shared
                  pair offers, because this band's first paragraph is the
                  set-up offer ("Write to us, and someone here builds your shop
                  with you"); a support mailto stood here until 2026-10-07 and
                  sent a reader who had just decided to the wrong inbox. The
                  support address keeps its one home in the list beside.

                  The pricing door states the figure in its own words rather
                  than parking it behind itself; "See what it costs" is the
                  unlabeled door a skeptic reads as "they won't say"
                  (docs/product/marketing-review-20260827.md, diagnosis 2).
                  Interpolated, never spelled: `earlyAccessPrice` is H-12's
                  single source, and `src/lib/marketing.test.ts` counts this key
                  among the sentences that must carry `{price}` and `{cadence}`.

                  The switching door is tagged like the homepage's doors onto
                  the same surface — the one in-page switching door on `/about`
                  takes the page's own name. The nav and footer links stay bare
                  on purpose: they render on every marketing page, so one tag
                  across all of them would answer nothing. `flush`: it wraps
                  under the two outline doors onto a line of its own, where the
                  size's `px-4` set its words 16px inside the column (K-397). */}
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={setUpMailto(t("marketing.common.setUpSubject"))}
                  className={buttonClass({ variant: "outline" })}
                >
                  {t("marketing.common.getSetUp")}
                </a>
                <Link href="/pricing" className={buttonClass({ variant: "outline" })}>
                  {t("marketing.about.seeCost", {
                    price: earlyAccessPrice.price,
                    cadence: t(earlyAccessPrice.cadenceKey),
                  })}
                </Link>
                <Link
                  href={switchingHref("/switching", "about-switching")}
                  className={buttonClass({ variant: "link", flush: true })}
                >
                  {t("marketing.about.switchingLink")}
                </Link>
              </div>
            </div>
            {/* `bg-background` by hand rather than `SectionCard`: this list
                sits against the page and is deliberately the quieter surface
                of the two columns. `SectionCard padding="none"` is otherwise
                exactly its shape, and it converts the day the component grows
                an answer for a card that is not `bg-surface`. */}
            <dl className="divide-y divide-border rounded-panel border border-border bg-background">
              <div className="p-6">
                <dt className={groupLabelClass("primary")}>
                  {t("marketing.about.whereLiveLabel")}
                </dt>
                <dd className="mt-2 leading-7">{t("marketing.about.whereLiveValue")}</dd>
              </div>
              <div className="p-6">
                <dt className={groupLabelClass("primary")}>
                  {t("marketing.about.committingLabel")}
                </dt>
                <dd className="mt-2 leading-7">{t("marketing.about.committingValue")}</dd>
              </div>
              <div className="p-6">
                <dt className={groupLabelClass("primary")}>
                  {t("marketing.about.whoAnswersLabel")}
                </dt>
                <dd className="mt-2 leading-7">
                  {t("marketing.about.whoAnswersValue", { email: SUPPORT_EMAIL })}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-7xl px-6 py-20 text-center lg:py-28">
          <h2 className={`mx-auto max-w-3xl ${BANNER_TITLE_CLASS} sm:text-4xl`}>
            {t("marketing.about.closingTitle")}
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-muted">
            {t("marketing.about.closingDescription")}
          </p>
          <FunnelCtas locale={locale} source="about-closing" className="mt-8 justify-center" />
        </div>
      </section>
    </main>
  );
}
