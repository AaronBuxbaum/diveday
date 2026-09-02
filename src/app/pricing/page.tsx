import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { Suspense } from "react";
import { FunnelCtas } from "@/app/_components/FunnelCtas";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { MarketingSectionMotion } from "@/components/MarketingReveal";
import { ExportBundleFallback } from "@/components/MarketingScreenFallbacks";
import { MarketingMockup } from "@/components/MarketingSections";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { buttonClass } from "@/components/ui/button";
import { BANNER_TITLE_CLASS, DISPLAY_TITLE_CLASS } from "@/components/ui/typography";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { cachedListFormat } from "@/lib/intl-cache";
import { earlyAccessPrice, fullShopExport, sharedLinkCard } from "@/lib/marketing";
import { getMigrationGuide, MIGRATION_GUIDES } from "@/lib/migration-guides";
import { SUPPORT_EMAIL, UPGRADE_EMAIL } from "@/lib/platform-mail";

// `instant = true`: navigating here paints immediately. The request-scoped
// read this page makes (`requestLocale()`) sits behind this segment's
// `loading.tsx` — the boundary of record for a page — so the frame lands
// without waiting on the request. `next build` audits the claim. See ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Pricing — one flat price per shop | DiveDay",
  description:
    "One flat price for the whole dive shop — bookings, waivers, cert checks, trip prep, and the boat manifest included. No setup fee, no per-seat math, no feature tiers.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    ...sharedLinkCard,
    title: "DiveDay pricing — one flat price per shop",
    description:
      "Every workflow DiveDay ships, in one plan. No setup fee, no per-seat math, no feature tiers.",
    url: "/pricing",
  },
  // `summary_large_image`: the OG block above names the shared link card
  // (`sharedLinkCard` → `src/app/opengraph-image.tsx`), so the large card has an
  // image to fill it — docs/product/marketing.md, Twitter-card policy. The
  // price figure deliberately stays out of the card: it lives in exactly one
  // place (`earlyAccessPrice`), and a card is a copy that goes stale silently.
  twitter: {
    card: "summary_large_image",
    title: "DiveDay pricing — one flat price per shop",
    description:
      "Every workflow DiveDay ships, in one plan. No setup fee, no per-seat math, no feature tiers.",
  },
};

/**
 * The body renders **once**, in the reader's own language — see `ProductPage`
 * for the whole story. In short: the fallback used to be a second, English
 * render of this entire page, and swapping it out for the negotiated-locale
 * one tore down and rebuilt the subtree, discarding whatever the visitor had
 * already done to it (FU-20260812-marketing-suspense-swap-discards-interaction).
 * The instant paint now comes from this segment's `loading.tsx`, which has
 * nothing interactive in it to lose.
 */
export default async function PricingPage() {
  const locale = await requestLocale();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <PricingBody locale={locale} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale (DIVER_LOCALES — two entries) — no session-scoped content. */
async function PricingBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  // Generated from the migration-guides registry, never hand-listed, so a new
  // guide can't be silently omitted from this answer.
  const competitors = cachedListFormat(locale, { type: "conjunction" }).format(
    MIGRATION_GUIDES.map((guide) => guide.competitor),
  );

  /**
   * The anchor a flat price needs: the other pricing model a dive shop is
   * actually offered. Both rows restate what the incumbent itself publishes —
   * or, for FareHarbor, that it publishes nothing and the figure is a
   * third-party report — and each links to the switching guide that carries the
   * citations (docs/product/marketing.md: competitor statements are documented
   * fact, and an unpublished fee is never stated as a published price).
   *
   * Deliberately absent: any figure for what a shop pays in practice, any
   * per-booking volume, and any arithmetic comparing the two. We have no
   * customers, so we have no basis for either, and inventing one to make the
   * flat price look better is the exact failure the claims policy exists to
   * stop. Rows are derived from the guide registry, so a de-registered guide
   * drops its row rather than leaving a dead link on the pricing page.
   */
  const rezdyGuide = getMigrationGuide("rezdy");
  const fareHarborGuide = getMigrationGuide("fareharbor");
  const channelFees = [
    rezdyGuide && {
      guide: rezdyGuide,
      claim: t("marketing.pricing.feeAnchor.rezdy", { competitor: rezdyGuide.competitor }),
    },
    fareHarborGuide && {
      guide: fareHarborGuide,
      claim: t("marketing.pricing.feeAnchor.fareharbor", {
        competitor: fareHarborGuide.competitor,
      }),
    },
  ].flatMap((row) => (row ? [row] : []));

  // "What is included?" left this list on 2026-08-13: the hero now answers it
  // in the first screenful, and a FAQ row restating the screen above it is the
  // duplication the three-densities rule exists to stop.
  // `link` is one optional pair, not two independent optional fields: a row
  // carrying an href with no label (or the reverse) would render no door at
  // all, silently and with nothing to typecheck against.
  const faq: readonly {
    question: string;
    answer: string;
    link?: { href: string; label: string };
  }[] = [
    {
      question: t("marketing.pricing.faq.billing.question"),
      answer: t("marketing.pricing.faq.billing.answer"),
    },
    {
      // The per-seat fear, answered where the flat price raises it: the
      // number above is per *location*, and the roles it covers are the six
      // in src/lib/authz.ts's STAFF_ROLES. Divers never authenticate at all —
      // they book on the public shop pages and reach their own trip through a
      // capability link, so a growing customer list is not a growing bill
      // either.
      question: t("marketing.pricing.faq.crewSize.question"),
      answer: t("marketing.pricing.faq.crewSize.answer"),
    },
    {
      question: t("marketing.pricing.faq.trialMeaning.question"),
      // The upgrade address, not the support one: marketing.md routes "how do
      // I move a trial shop to paid" through its own inbox, and the soft
      // expiry ("nothing switches off") restates src/lib/trial.ts, where
      // expiry blocks no route and no mutation.
      answer: t("marketing.pricing.faq.trialMeaning.answer", { email: UPGRADE_EMAIL }),
    },
    {
      question: t("marketing.pricing.faq.seeBefore.question"),
      answer: t("marketing.pricing.faq.seeBefore.answer"),
    },
    {
      // Counted against the real form: /onboard asks for six fields (shop
      // name, link, timezone, then the owner's name, email and password) and
      // its action inserts the shop row on submit. The spreadsheet is named as
      // its own step because it is one — but the importer's preview belongs to
      // the `switching` row below, not here: in the row-major two-column grid
      // this row and that one are vertically adjacent in the left column, and
      // both used to close on the same eight-word promise about seeing what
      // will happen before anything is saved. This is the time question, so it
      // ends on time.
      question: t("marketing.pricing.faq.setupTime.question"),
      answer: t("marketing.pricing.faq.setupTime.answer"),
    },
    // "Does the manifest work offline?" left this list on 2026-08-28: a
    // product question wearing pricing clothes, and /product answers it at
    // depth beside the screen it is about (`marketing.product.dockNote`).
    // Nothing on this page decides on it (docs/product/marketing-review-20260827.md).
    {
      question: t("marketing.pricing.faq.dataIfNotWorking.question"),
      answer: t("marketing.pricing.faq.dataIfNotWorking.answer", {
        claim: t(fullShopExport.claimKey),
        terms: t(fullShopExport.termsKey),
      }),
    },
    {
      question: t("marketing.pricing.faq.switching.question"),
      answer: t("marketing.pricing.faq.switching.answer", { competitors }),
      // The one row whose answer is a door as much as a sentence: the guides
      // it names live at /switching, and without this link the footer is the
      // only path to them from here.
      link: { href: "/switching", label: t("marketing.pricing.faq.switching.guidesLink") },
    },
    {
      question: t("marketing.pricing.faq.agency.question"),
      answer: t("marketing.pricing.faq.agency.answer"),
    },
    {
      question: t("marketing.pricing.faq.pos.question"),
      answer: t("marketing.pricing.faq.pos.answer"),
    },
    {
      question: t("marketing.pricing.faq.whyFounding.question"),
      answer: t("marketing.pricing.faq.whyFounding.answer"),
    },
    {
      question: t("marketing.pricing.faq.multipleLocations.question"),
      answer: t("marketing.pricing.faq.multipleLocations.answer", { email: SUPPORT_EMAIL }),
    },
  ];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD structured data built from our own constants above and `<`-escaped below.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c"),
        }}
      />
      <main className="flex-1">
        <MarketingSectionMotion />
        {/* The price is the hero. A pricing page's arriving question is "what
            does it cost and what's the catch", so the first composition
            carries the whole answer in one piece: the plan, the headline, the
            number at display scale, the catches removed, both doors and what
            clicking one costs, then — behind a hairline, in the same
            container — what the number buys. No card border, no shadow; the
            figure itself is the weight. The old page answered in screenful
            two, inside a bordered card below a generic headline band. */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-3xl px-6 pt-20 pb-16 lg:pt-28 lg:pb-20">
            <div className="text-center">
              {/* The spaces around the separator are load-bearing, not
                  formatting: the middot is `aria-hidden`, and JSX drops the
                  newlines between these three children, so without them the
                  accessible name is the single word "Founding shopEarly
                  access". */}
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t(earlyAccessPrice.nameKey)}{" "}
                <span aria-hidden="true" className="mx-1 text-border-strong">
                  ·
                </span>{" "}
                {t("marketing.pricing.earlyAccessBadge")}
              </p>
              <h1 className={`mt-5 ${DISPLAY_TITLE_CLASS} sm:text-5xl`}>
                {t("marketing.pricing.heroTitle")}
              </h1>
              {/* Cadence below the figure, not baseline-set beside it: paired
                  on one line, centring the pair pushed `$99` itself off centre
                  by half the cadence's width. */}
              <p className="mt-10 text-7xl leading-none font-semibold tracking-[-0.06em] sm:text-8xl">
                {earlyAccessPrice.price}
              </p>
              <p className="mt-4 text-base text-muted">{t(earlyAccessPrice.cadenceKey)}</p>
              {/* The two-year lock, under the figure it is about. It used to
                  be reachable only by reading the included list (`item5`) and
                  the founding-shop FAQ row — two places, neither of them where
                  a reader is looking at the number and asking "for how long".
                  `item5` was retired rather than trimmed, so the claim is not
                  inventoried twice (docs/product/marketing-review-20260827.md).
                  A restatement of a binding commercial commitment (H-12),
                  never an extension of it.

                  It names its subject — "Today's price, locked for…" — because
                  this is fine print under a figure, the slot a reader who has
                  been burned scans for the catch, and a subjectless "Locked
                  for two years" lets them supply "I am" as the subject on a
                  page whose next band argues they can leave any day. Naming it
                  costs a second line on a phone, and `text-pretty` is what
                  stops that line being the word "shops." alone. */}
              <p className="mt-2 text-sm leading-6 text-pretty text-muted">
                {t("marketing.pricing.lockNote")}
              </p>
              {/* Two blocks, not one paragraph: as one they broke mid-clause
                  ("No cut / of your bookings") directly under the figure. The
                  split protects the break, not a line count — the longer
                  Spanish negations wrap, and wrap between sentences. */}
              <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-muted">
                {t("marketing.pricing.heroDescription")}
              </p>
              <p className="mx-auto mt-1 max-w-2xl text-lg leading-8 text-muted">
                {t("marketing.pricing.heroSafetyNote")}
              </p>
              <FunnelCtas locale={locale} source="pricing" className="mt-9 justify-center" />
              {/* What the click costs, at the point of decision — the same
                  shared line `/` and `/product` carry under their own demo
                  doors. On this page the answer used to sit in a FAQ row two
                  thousand pixels down. */}
              <p className="mx-auto mt-6 max-w-lg text-sm leading-6 font-medium text-balance text-muted">
                {t("marketing.common.demoNote")}
              </p>
              {/* And what the *other* door costs. The demo note has always
                  answered for the demo alone — it must not promise "no
                  sign-up" on the trial's behalf — so the trial button stood
                  here with no terms at all, at the one point on the site where
                  the decision is made. Soft expiry is a fact, not a
                  softener: src/lib/trial.ts blocks no route and no mutation
                  when the window elapses. A `<p>`, deliberately: the hero's
                  door budget is two, and the DOM order of those two is pinned
                  in e2e/marketing.spec.ts.

                  `text-pretty`, not the `text-balance` its neighbour uses:
                  balancing two lines of this sentence puts the break inside
                  "no / card", which is the one clause a reader is scanning
                  for. Pretty leaves the fill alone and only guards the
                  orphan.

                  `font-medium`, matching the demo note above it rather than
                  sitting a weight under it: these are two notes of one kind —
                  terms at a door — and the trial is the door with the higher
                  friction, so setting only the demo's terms in medium put the
                  more weight on the easier ask. On `/` the medium note sits
                  beside a regular *price line*, which is context rather than
                  terms; that page keeps its pairing. */}
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 font-medium text-pretty text-muted">
                {t("marketing.pricing.trialNote")}
              </p>
            </div>

            {/* What the number buys, right under the number — the one plan's
                own list from `earlyAccessPrice`, not a third render of the
                feature grid. The grid's summary cards used to reappear here a
                thousand pixels down at a third density; the inventory lives one
                click away on /product, and this list plus that link is the
                whole answer (docs/product/marketing.md, "never inventory the
                same thing twice").

                Same container as the pitch above it, so the list's left edge
                lands on the headline's own margin instead of 48px inside it,
                and a hairline marks the turn from argument to spec sheet. */}
            <div className="mt-14 border-t border-border pt-10">
              <h2 className="text-sm font-semibold tracking-widest text-muted uppercase">
                {t("marketing.pricing.includedLead")}
              </h2>
              <ul className="mt-5 grid gap-x-10 gap-y-3 leading-6 sm:grid-cols-2">
                {earlyAccessPrice.includedKeys.map((item) => (
                  <li key={item} className="flex gap-3">
                    <DiveDayIcon name="check" className="mt-1 size-4 shrink-0 text-primary" />
                    <span className="text-muted">{t(item)}</span>
                  </li>
                ))}
              </ul>
              {/* `flush`, not `className: "px-0"`: the size's own `px-4` wins
                  a `className` override (stylesheet order, not source order —
                  see src/components/ui/button.ts), which is why this link used
                  to render 12 measured pixels inside the checkmarks above it. */}
              <Link
                href="/product"
                className={buttonClass({ variant: "link", flush: true, className: "mt-4" })}
              >
                {t("marketing.pricing.seeFullList")}
              </Link>
              {/* The one cost the price does not cover, as the footnote to the
                  list of what it does — the same thought, finished. It carried
                  a second sentence ("if an integration ever costs extra, we'll
                  say so before you turn it on") until 2026-08-28: a promise
                  about an unshipped condition, sitting under "What the price
                  covers" and telling a reader who has just absorbed four
                  negations that a fifth charge might arrive later. It answered
                  a question nobody asked about a charge that does not exist
                  (AGENTS.md, "every sentence earns its place, or it is
                  deleted"). */}
              <p className="mt-8 max-w-xl text-sm leading-6 text-muted">
                {t("marketing.pricing.feesNote")}
              </p>
            </div>
          </div>
        </section>

        {/* The flat price is only meaningful next to the model it replaces.
            Quiet rows, not equal-weight cards: the incumbents' terms are
            evidence, and our answer is the one line that gets full ink. */}
        <section className="border-b border-border">
          <div className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.pricing.feeAnchor.title")}
            </h2>
            <p className="mt-5 leading-7 text-muted">{t("marketing.pricing.feeAnchor.body")}</p>
            <ul className="mt-10 space-y-8">
              {channelFees.map(({ guide, claim }) => (
                <li key={guide.slug}>
                  <h3 className="font-semibold leading-6">{guide.competitor}</h3>
                  <p className="mt-1 leading-7 text-muted">{claim}</p>
                  <Link
                    href={`/switching/${guide.slug}`}
                    className={buttonClass({
                      variant: "link",
                      flush: true,
                      className: "mt-1 text-left",
                    })}
                  >
                    {t("marketing.pricing.feeAnchor.guideLink", { competitor: guide.competitor })}
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-10 border-l-2 border-primary pl-5 text-lg leading-8">
              {t("marketing.pricing.feeAnchor.ours")}
            </p>
            <p className="mt-5 text-sm leading-6 text-muted">
              {t("marketing.pricing.feeAnchor.sourcesNote")}
            </p>
          </div>
        </section>

        {/* The page's other big claim: you can leave with your records any
            day. It sits here rather than in the FAQ because this is where the
            objection actually lands — the fee anchor above has just made
            switching look attractive, and the next thought a shop owner has is
            about being stuck again. The FAQ row (`faq.dataIfNotWorking`) still
            answers it in words for someone scanning that far; this answers it
            with the screen.

            The mockup is a claim, so it mirrors the real Settings → Data export
            element for element — including the "Not included, on purpose:" line
            that says credentials never leave (docs/product/marketing.md). */}
        {/* `max-w-5xl`, the same measure as the FAQ below it: the page was
            running three different left edges down the desktop viewport (88px
            here, 152px at the FAQ, 280px for the single-column bands), which
            reads as three unrelated pages stacked. Two measures now — narrow
            for prose, wide for the two-column bands — and the columns land at
            a more readable ~470px besides. */}
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-5xl gap-10 px-6 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
            <div>
              <p className="text-sm font-semibold tracking-widest text-primary uppercase">
                {t("marketing.pricing.dataExit.eyebrow")}
              </p>
              <h2 className={`mt-4 ${BANNER_TITLE_CLASS} sm:text-4xl`}>
                {t("marketing.pricing.dataExit.title")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-muted">
                {t("marketing.pricing.dataExit.body")}
              </p>
              <p className="mt-4 leading-7 text-muted">
                {t("marketing.pricing.dataExit.securityNote")}
              </p>
            </div>
            <MarketingMockup
              label={t("marketing.pricing.dataExit.mockupLabel")}
              className="shadow-xl shadow-foreground/5"
            >
              <ExportBundleFallback locale={locale} />
            </MarketingMockup>
          </div>
        </section>

        {/* The objection layer, designed quiet: two columns of plain Q&A,
            hierarchy by weight and space rather than a stack of bordered
            cards. Answers stay in the document (not behind a disclosure) —
            they are also the FAQPage structured data above, and a buyer
            scanning for one word shouldn't have to open ten boxes. */}
        <section className="mx-auto max-w-5xl px-6 py-16 lg:py-24">
          <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>{t("marketing.pricing.faqTitle")}</h2>
          <div className="mt-10 grid gap-x-14 gap-y-10 md:grid-cols-2">
            {faq.map((item) => (
              <article key={item.question}>
                <h3 className="font-semibold leading-6">{item.question}</h3>
                <p className="mt-2 leading-7 text-muted">{item.answer}</p>
                {item.link ? (
                  <Link
                    href={item.link.href}
                    className={buttonClass({
                      variant: "link",
                      flush: true,
                      className: "mt-1 text-left",
                    })}
                  >
                    {item.link.label}
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        {/* The page opens with the number and closes with it. Between the two
            is roughly five thousand pixels of phone scroll in which the only
            door was the header's — the marketing nav does not stick, so a
            reader who scrolled the objections had nothing to act on but the
            back button. The funnel's pair here and one quiet mail door beneath
            it: the closing restates the price rather than making a new argument,
            and it is tagged `pricing-close` so it can be shown to have earned
            its place instead of folding into the page's own bucket
            (src/lib/funnel.ts). */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-2xl px-6 py-16 text-center lg:py-20">
            <h2 className={`${BANNER_TITLE_CLASS} sm:text-4xl`}>
              {t("marketing.pricing.closingTitle")}
            </h2>
            <p className="mt-4 text-lg leading-8 text-balance text-muted">
              {t("marketing.pricing.closingBody", {
                price: earlyAccessPrice.price,
                cadence: t(earlyAccessPrice.cadenceKey),
              })}
            </p>
            {/* Both doors, not just the trial. The demo used to be dropped here
                — at the one moment a reader who has just read the whole price
                page is warmest, the only door left asked for an account
                (issue #785). */}
            <FunnelCtas locale={locale} source="pricing-close" className="mt-8 justify-center" />
            {/* The same terms at the second door. `demoNote` is stated once
                per page, at the first door (docs/product/marketing.md) — the
                trial note is deliberately not: a reader who scrolled five
                thousand pixels of objections to reach this band is being asked
                to commit here, and the closing pair carried no terms at all.
                The divergence is recorded in marketing.md beside that rule.
                Same `font-medium` as the hero's copy of it, for the same
                reason. */}
            <p className="mx-auto mt-4 max-w-xl text-sm leading-6 font-medium text-pretty text-muted">
              {t("marketing.pricing.trialNote")}
            </p>
            <p className="mt-10 text-sm leading-6 text-muted">
              {t("marketing.pricing.stillQuestion")}
            </p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className={buttonClass({ variant: "link", size: "sm" })}
            >
              {t("marketing.pricing.emailCta", { email: SUPPORT_EMAIL })}
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
