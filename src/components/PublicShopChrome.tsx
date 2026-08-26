import Link from "next/link";
import type { LanguageChoice } from "@/components/LanguageChoices";
import { LanguagePicker, type LanguagePickerCopy } from "@/components/LanguagePicker";
import { PublicShopNav, type PublicShopNavItem } from "@/components/PublicShopNav";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { type ConservationCommitment, parseConservationCommitments } from "@/lib/conservation";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { publicSchedulePath } from "@/lib/public-routes";
import { shopAddressLines, shopMapQuery } from "@/lib/shop-address";

/**
 * The public shop's own identity and the map of its public pages, shown on
 * every `/s/[shopSlug]` page (task 9,
 * docs/product/archive/ux-personas-20260730-findings.md). Before this, the
 * schedule's `<h1>` read "Schedule" with no shop name, logo, or contact
 * anywhere — nothing told a diver comparing two shops in another tab which one
 * they were looking at. Staff get `ShopNav` on their own namespace instead
 * (src/app/shop/[shopSlug]/layout.tsx); this is the diver-side counterpart, and
 * never renders in `?embed=1` mode, which already carries its own framing on
 * the page that embeds it.
 *
 * The header shows the shop's name, where a diver can go, and — beside the
 * name — which language they are reading in. Phone and email live in the
 * footer, once: repeating them up here made the top of every page a contact
 * card and left no room for the navigation that was actually missing.
 *
 * The language control sits with the shop's own identity rather than in the
 * nav, because it is not a destination. It is the one control on a public page
 * whose *label* the reader may not be able to read, which is why each option
 * is its own language's name for itself and why it is on the first band of the
 * page rather than filed in the footer.
 */
export function PublicShopHeader({
  shop,
  navAriaLabel,
  navItems,
  locale,
  localeLabel,
  languages,
  setLocale,
  languagePickerCopy,
}: {
  shop: { slug: string; name: string };
  navAriaLabel: string;
  navItems: readonly PublicShopNavItem[];
  /** The language this page was written in — the one marked as in force. */
  locale: string;
  /** That language's own name for itself. */
  localeLabel: string;
  /** Every language DiveDay carries, each named in itself — including `locale`. */
  languages: readonly LanguageChoice[];
  setLocale: (locale: string) => Promise<void>;
  languagePickerCopy: LanguagePickerCopy;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
        <Link
          href={publicSchedulePath(shop.slug)}
          className="inline-flex min-h-11 items-center text-lg font-semibold tracking-tight"
        >
          {shop.name}
        </Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PublicShopNav ariaLabel={navAriaLabel} items={navItems} />
          <LanguagePicker
            current={locale}
            currentLabel={localeLabel}
            choices={languages}
            setLocale={setLocale}
            copy={languagePickerCopy}
          />
        </div>
      </div>
    </header>
  );
}

export function PublicShopFooter({
  shop,
  spokenLanguagesLine,
  t,
}: {
  shop: {
    slug: string;
    name: string;
    contactEmail: string | null;
    contactPhone: string | null;
    addressStreet: string | null;
    addressLocality: string | null;
    addressRegion: string | null;
    addressPostalCode: string | null;
    addressCountry: string | null;
    conservationCommitments?: readonly string[] | null;
  };
  /**
   * Pre-formatted, already-joined ("Deutsch, 日本語"), or null when no active
   * staff member has recorded a language (issue #708). Named in each
   * language's own endonym, not the reader's locale — the whole point is
   * that a diver recognises their own language among the shop's, whatever
   * language the page itself renders in.
   */
  spokenLanguagesLine: string | null;
  t: DiverTranslator;
}) {
  // **Where the shop is** — the first question a visiting diver asks, and the
  // one that decides whether a shop is even a candidate. It was modelled, it
  // was in the page's JSON-LD, and it was on `/ready`, which a diver reaches
  // *after* they have paid. A crawler reading this page learned the postal
  // address; a tourist comparing three Key Largo shops on their phone had to
  // leave the site to find out which one was walkable (issue #704).
  //
  // Nothing at all when there is nothing on file — the same call `shopAddressOf`
  // already makes for the structured data, rather than an empty block.
  const address = {
    street: shop.addressStreet,
    locality: shop.addressLocality,
    region: shop.addressRegion,
    postalCode: shop.addressPostalCode,
    country: shop.addressCountry,
  };
  const addressLines = shopAddressLines(address);
  // A link out, never an embedded map: a third-party frame on an anonymous,
  // marketing-facing page costs Core Web Vitals and adds a tracker. `/ready`'s
  // iframe is a page the diver already trusts.
  const mapQuery = shopMapQuery(shop.name, address);
  const addressText = addressLines.join(", ");
  const commitmentKeys: Record<ConservationCommitment, DiverMessageKey> = {
    aware_partner: "shopChrome.conservationCommitmentAwarePartner",
    green_fins_member: "shopChrome.conservationCommitmentGreenFinsMember",
    reef_cleanup: "shopChrome.conservationCommitmentReefCleanup",
    mooring_buoys: "shopChrome.conservationCommitmentMooringBuoys",
    no_gloves: "shopChrome.conservationCommitmentNoGloves",
    wildlife_distance: "shopChrome.conservationCommitmentWildlifeDistance",
  };
  const commitments = parseConservationCommitments(shop.conservationCommitments);
  // Built above the JSX rather than nested in it: `check:copy` reads a ternary
  // chain inside an element as prose, and this one is three deep.
  const addressNode =
    addressLines.length === 0 ? null : mapQuery ? (
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-foreground hover:underline"
      >
        {addressText}
      </a>
    ) : (
      // On file, but not enough to point a map at a real place — a country and
      // a shop name would centre on a continent and present it as the front
      // door. The words still help; the link would not.
      <span>{addressText}</span>
    );

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <p>{t("shopChrome.footerLine", { shop: shop.name })}</p>
          {spokenLanguagesLine ? (
            <p>{t("shopChrome.spokenLanguages", { languages: spokenLanguagesLine })}</p>
          ) : null}
          {commitments.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium text-foreground">
                {t("shopChrome.conservationCommitmentsHeading")}
              </p>
              <ul className="mt-1 list-inside list-disc">
                {commitments.map((commitment) => (
                  <li key={commitment}>{t(commitmentKeys[commitment])}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {addressNode}
          {shop.contactPhone ? (
            <a href={telHref(shop.contactPhone)} className="hover:text-foreground hover:underline">
              {shop.contactPhone}
            </a>
          ) : null}
          {shop.contactEmail ? (
            <a
              href={mailtoHref(shop.contactEmail)}
              className="hover:text-foreground hover:underline"
            >
              {shop.contactEmail}
            </a>
          ) : null}
        </p>
      </div>
    </footer>
  );
}
