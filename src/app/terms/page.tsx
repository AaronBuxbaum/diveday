import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { Suspense } from "react";
import { MarketingNav, MarketingNavFallback } from "@/app/_components/MarketingNav";
import { LegalDocument, LegalSection, LegalTermList } from "@/components/LegalDocument";
import { MarketingFooter, MarketingFooterFallback } from "@/components/MarketingFooter";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import type { DiverLocale } from "@/i18n/settings";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { openGraphSite } from "@/lib/site-metadata";

// `instant = true` — see the note on `/privacy`, and ADR
// 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = {
  title: "Terms of use — DiveDay",
  description:
    "How DiveDay is meant to be used, what we promise and what we deliberately do not, whose data it is, and what happens when a shop wants to leave.",
  alternates: { canonical: "/terms" },
  openGraph: {
    // Site-level fields only, no marketing card — same reasoning as `/privacy`.
    ...openGraphSite,
    title: "Terms of use",
    description: "What we owe each other.",
    url: "/terms",
  },
  twitter: {
    card: "summary",
    title: "Terms of use",
    description: "What we owe each other.",
  },
};

/**
 * The terms page, published 2026-08-14 alongside `/privacy`
 * (FU-20260812-no-privacy-or-terms-page).
 *
 * Written under the same two constraints as its sibling, for the same reasons:
 * **no legal entity is named** (H-18 is open), and every promise is one the
 * product already keeps. That second rule is why the "what we do not promise"
 * section exists and says there is no uptime guarantee — printing an SLA
 * before there is a track record to back it would be exactly the unprovable
 * claim `docs/product/marketing.md` forbids, and conceding it loudly is worth
 * more than asserting it.
 *
 * The price is **not** restated here. H-12 requires one source for that number,
 * which is `earlyAccessPrice` (`src/lib/marketing.ts`) rendered on `/pricing`;
 * this page points there instead. A terms page quoting a stale figure is a
 * worse problem than a terms page that does not quote one.
 *
 * Not linked from the footer or `/onboard` yet — the owner's explicit call.
 * See the note on `/privacy` before adding one.
 */
export default async function TermsPage() {
  const locale = await requestLocale();
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<MarketingNavFallback />}>
        <MarketingNav />
      </Suspense>
      <TermsBody locale={locale} />
      <Suspense fallback={<MarketingFooterFallback />}>
        <MarketingFooter />
      </Suspense>
    </div>
  );
}

/** Cached per negotiated locale — no session-scoped content anywhere on it. */
async function TermsBody({ locale }: { locale: DiverLocale }) {
  "use cache";
  cacheLife("max");
  const t = diverTranslator(locale);
  const p = (key: string) => t(`marketing.terms.${key}` as Parameters<typeof t>[0]);

  return (
    <LegalDocument
      eyebrow={p("eyebrow")}
      title={p("title")}
      updated={p("updated")}
      intro={p("intro")}
    >
      <LegalSection heading={p("what.heading")}>
        <p>{p("what.body")}</p>
      </LegalSection>

      <LegalSection heading={p("account.heading")}>
        <LegalTermList
          items={[
            { term: p("account.accurateTerm"), body: p("account.accurateBody") },
            { term: p("account.legalTerm"), body: p("account.legalBody") },
            { term: p("account.accessTerm"), body: p("account.accessBody") },
          ]}
        />
      </LegalSection>

      <LegalSection heading={p("payments.heading")}>
        <p>{p("payments.body")}</p>
      </LegalSection>

      <LegalSection heading={p("data.heading")}>
        <p>{p("data.body")}</p>
      </LegalSection>

      <LegalSection heading={p("availability.heading")}>
        <p>{p("availability.body")}</p>
      </LegalSection>

      <LegalSection heading={p("acceptable.heading")}>
        <p>{p("acceptable.body")}</p>
      </LegalSection>

      <LegalSection heading={p("ending.heading")}>
        <p>{p("ending.body")}</p>
      </LegalSection>

      <LegalSection heading={p("changes.heading")}>
        <p>{p("changes.body")}</p>
      </LegalSection>

      <LegalSection heading={p("contact.heading")}>
        {/* The one action on the page, so it is a real mailto rather than an
            address a reader has to select and copy. `t.rich` because the link
            has to wrap the address *inside* the sentence — the address itself
            stays `SUPPORT_EMAIL` (src/lib/platform-mail.ts) rather than being
            typed into two locale bundles where it could drift. */}
        <p>
          {t.rich("marketing.terms.contact.body", {
            address: SUPPORT_EMAIL,
            email: (chunks) => (
              <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {chunks}
              </a>
            ),
          })}
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
