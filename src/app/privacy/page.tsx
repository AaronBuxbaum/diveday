import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { LegalDocument, LegalList, LegalSection, LegalTermList } from "@/components/LegalDocument";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { openGraphSite } from "@/lib/site-metadata";

// `instant = true`: navigating here paints immediately, with this segment's
// `loading.tsx` standing in while the request-scoped locale read streams.
// See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "How DiveDay handles data — DiveDay",
  description:
    "What DiveDay stores on a shop's behalf, where it is processed, who else touches it, how long it is kept, and how a shop takes it back out.",
  alternates: { canonical: "/privacy" },
  openGraph: {
    // `openGraphSite` rather than `sharedLinkCard`: this page has no
    // link-preview image of its own and does not want the marketing card, so it
    // spreads only the site-level fields. Next merges `metadata` shallowly, so
    // a page-level `openGraph` block that omitted this would silently drop
    // `og:site_name` and `og:type` (src/lib/site-metadata.ts).
    ...openGraphSite,
    title: "How DiveDay handles data",
    description: "What we hold, where it lives, and how it leaves.",
    url: "/privacy",
  },
  // `summary`, not `summary_large_image`: there is no image behind this card,
  // and a large card with nothing to fill it renders as a blank slab
  // (docs/product/marketing.md, Twitter-card policy).
  twitter: {
    card: "summary",
    title: "How DiveDay handles data",
    description: "What we hold, where it lives, and how it leaves.",
  },
};

/**
 * The data-handling page, published 2026-08-14.
 *
 * ## Why it exists at all
 *
 * DiveDay stores signed waivers, medical answers and certification evidence
 * belonging to *other people's* customers, and until this page there was not
 * one sentence anywhere on the site about what happens to any of it. The whole
 * positioning is safe custodianship — the export ZIP, the shop's own Stripe
 * account, the append-only roll call — and the one question a careful buyer
 * asks had no answer (FU-20260812-no-privacy-or-terms-page).
 *
 * ## The rule this page is written under
 *
 * **Only current, verifiable behaviour.** Every claim here is readable off the
 * code: the sub-processors off `src/app/observability-client.tsx` and the
 * notification adapters, the retention windows off `RETENTION_DAYS`
 * (`src/lib/retention.ts`), the capability-URL redaction off
 * `src/lib/capability-urls.ts`. Nothing is aspirational, and where a policy is
 * genuinely unsettled the page says *that* rather than inventing a number.
 *
 * Two things are deliberately absent, and both are somebody else's call to
 * make rather than an oversight:
 *
 *  - **No legal entity is named.** H-18 is open, and `docs/product/marketing.md`
 *    keeps the corporate entity off the public pages until it closes.
 *  - **No retention period for waivers and medical answers.** H-02 is open. The
 *    page states what the system does today (they stay until the shop removes
 *    them) and says the policy is under review, which is true and is the one
 *    honest thing to write. Inventing a number here would pre-empt the decision
 *    in public, which is worse than the silence it replaced.
 *
 * ## No link to it yet
 *
 * `MarketingFooter` does **not** link here, and neither does `/onboard`. That
 * is the owner's explicit call (2026-08-14): the pages exist and are reachable,
 * but they are not advertised until the open rows above close and counsel has
 * read them. Do not "fix" the missing footer link — adding it is a decision,
 * not a tidy-up.
 */
export default async function PrivacyPage() {
  const locale = await requestLocale();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <PrivacyBody locale={locale} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale — no session-scoped content anywhere on it. */
async function PrivacyBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  const p = (key: string) => t(`marketing.privacy.${key}` as Parameters<typeof t>[0]);

  return (
    <LegalDocument
      eyebrow={p("eyebrow")}
      title={p("title")}
      updated={p("updated")}
      intro={p("intro")}
    >
      <LegalSection heading={p("roles.heading")}>
        <LegalTermList
          items={[
            { term: p("roles.shopTerm"), body: p("roles.shopBody") },
            { term: p("roles.diverTerm"), body: p("roles.diverBody") },
          ]}
        />
      </LegalSection>

      <LegalSection heading={p("collect.heading")}>
        <LegalTermList
          items={[
            { term: p("collect.staffTerm"), body: p("collect.staffBody") },
            { term: p("collect.diversTerm"), body: p("collect.diversBody") },
            { term: p("collect.waiversTerm"), body: p("collect.waiversBody") },
            { term: p("collect.paymentsTerm"), body: p("collect.paymentsBody") },
            { term: p("collect.trailsTerm"), body: p("collect.trailsBody") },
            { term: p("collect.devicesTerm"), body: p("collect.devicesBody") },
          ]}
        />
      </LegalSection>

      <LegalSection heading={p("where.heading")}>
        <p>{p("where.body")}</p>
      </LegalSection>

      <LegalSection heading={p("processors.heading")}>
        <p>{p("processors.intro")}</p>
        <LegalTermList
          items={[
            { term: p("processors.stripeTerm"), body: p("processors.stripeBody") },
            { term: p("processors.awsTerm"), body: p("processors.awsBody") },
            { term: p("processors.metaTerm"), body: p("processors.metaBody") },
            { term: p("processors.vercelTerm"), body: p("processors.vercelBody") },
            { term: p("processors.neonTerm"), body: p("processors.neonBody") },
            // The three a security review found missing on 2026-08-14, all of
            // them live and none of them visible from
            // `observability-client.tsx`, which is where the first draft's
            // derivation stopped. Sentry mounts from `instrumentation.ts` and
            // `instrumentation-client.ts`; Google arrives as the embedded map
            // in `src/lib/maps.ts`, which renders on a *diver's* trip-prep
            // page; the push vendors are the endpoint allowlist in
            // `src/lib/notifications/web-push.ts`. A list that reads as
            // exhaustive has to actually be exhaustive — the next third party
            // added anywhere in the app belongs here in the same change.
            { term: p("processors.sentryTerm"), body: p("processors.sentryBody") },
            { term: p("processors.googleTerm"), body: p("processors.googleBody") },
            { term: p("processors.pushTerm"), body: p("processors.pushBody") },
          ]}
        />
      </LegalSection>

      <LegalSection heading={p("links.heading")}>
        <p>{p("links.body")}</p>
      </LegalSection>

      {/* The numbers in this list are `RETENTION_DAYS` (src/lib/retention.ts)
          rendered as prose. They are stated in years and days rather than
          interpolated from the constant on purpose: a policy sentence reads
          "3 years", not "1095 days", and the two would drift apart in
          translation if the figure were injected. If RETENTION_DAYS changes,
          this copy is part of that change. */}
      <LegalSection heading={p("keep.heading")}>
        <p>{p("keep.intro")}</p>
        <LegalList
          items={[
            p("keep.activity"),
            p("keep.delivery"),
            p("keep.payments"),
            p("keep.webhooks"),
            p("keep.tokens"),
            p("keep.push"),
          ]}
        />
        <LegalTermList items={[{ term: p("keep.reviewTerm"), body: p("keep.reviewBody") }]} />
      </LegalSection>

      <LegalSection heading={p("out.heading")}>
        <LegalTermList
          items={[
            { term: p("out.exportTerm"), body: p("out.exportBody") },
            { term: p("out.erasureTerm"), body: p("out.erasureBody") },
          ]}
        />
      </LegalSection>

      <LegalSection heading={p("contact.heading")}>
        {/* The one action on the page, so it is a real mailto rather than an
            address a reader has to select and copy. `t.rich` because the link
            has to wrap the address *inside* the sentence — the address itself
            stays `SUPPORT_EMAIL` (src/lib/platform-mail.ts) rather than being
            typed into two locale bundles where it could drift. */}
        <p>
          {t.rich("marketing.privacy.contact.body", {
            address: SUPPORT_EMAIL,
            email: (chunks) => (
              <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {chunks}
              </a>
            ),
          })}
        </p>
      </LegalSection>

      <LegalSection heading={p("open.heading")}>
        <p>{p("open.body")}</p>
      </LegalSection>
    </LegalDocument>
  );
}
