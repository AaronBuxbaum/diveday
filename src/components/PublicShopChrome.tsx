import Link from "next/link";
import { ChromeBar } from "@/components/chrome/ChromeBar";
import type { LanguageChoice } from "@/components/LanguageChoices";
import { LanguagePicker, type LanguagePickerCopy } from "@/components/LanguagePicker";
import { LogoMark } from "@/components/Logo";
import { PublicShopHeaderHeight } from "@/components/PublicShopHeaderHeight";
import { PublicShopNav, type PublicShopNavItem } from "@/components/PublicShopNav";
import { tapTargetLinkClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";
import { mailtoHref, telHref } from "@/lib/contact-links";
import { openMapsUrl } from "@/lib/maps";
import { FIND_YOUR_BOOKING_PATH, publicSchedulePath } from "@/lib/public-routes";
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
 * The header shows the shop's name, where a diver can go, and which language
 * they are reading in. Phone and email live in the footer, once: repeating
 * them up here made the top of every page a contact card and left no room for
 * the navigation that was actually missing.
 *
 * **The shop's name owns the leading edge; everything else shares the trailing
 * one.** The language control used to sit beside the name, on the grounds that
 * it is identity rather than a destination. On a one-row bar that reasoning
 * cost the wrong thing: the name is the only place a shopfront page states
 * whose shop this is above the fold — the `<h1>` below it reads "Schedule" —
 * so anything sharing its edge is competing with the answer the diver came
 * for. Language moves in with the nav instead, where the two read as one
 * question ("which page, in which words") at the edge the name is not at, and
 * where each control can tighten on a phone without the name paying for it.
 * Each language is still named in itself, and it is still on the first band of
 * the page rather than filed in the footer, because it is the one control here
 * whose *label* the reader may not be able to read.
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
  recoveryLabel,
  recoveryHref = FIND_YOUR_BOOKING_PATH,
}: {
  shop: { slug: string; name: string; logoUrl?: string | null };
  navAriaLabel: string;
  navItems: readonly PublicShopNavItem[];
  recoveryLabel?: string;
  recoveryHref?: string;
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
    /* The staff shell's same surface, z-index and shared height token
       (ADR 20260827-clearwater-surface-language, decision 10).
       This header used to be its own shorter bar at `z-40`, which is why the
       schedule's sticky day headers, pinned at `top-0`, spent every scroll
       hidden underneath it. */
    <>
      <p
        data-public-print-identity
        className="hidden border-b border-border px-4 py-2 text-sm font-semibold print:block"
      >
        {shop.name}
      </p>
      <ChromeBar
        stackedOnPhone
        naturalHeight
        leading={
          /* The flexible identity yields to recovery's natural width. Fixed
           8px gaps preserve room for a first grapheme plus the full ellipsis
           when text grows; enlarged gutters must not consume that budget. */
          <div className="flex min-w-0 items-center justify-between gap-[8px]">
            <Link
              href={publicSchedulePath(shop.slug)}
              // diveday:allow-type-ramp: the shop name is a wordmark, not a heading
              className={`font-brand-display flex min-h-11 flex-1 ${shop.logoUrl ? "min-w-[calc(2rem_+_8px_+_2em)]" : "min-w-11"} items-center gap-[8px] text-lg font-semibold tracking-tight`}
            >
              {/* The shop's logo is the nav's mark beside its name (visual review
              2026-10-24, B16); it stood as an orphan tile beside the hero. */}
              {shop.logoUrl ? (
                // biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo
                <img
                  src={shop.logoUrl}
                  alt=""
                  className="size-8 shrink-0 rounded-inset border border-border bg-surface object-cover"
                />
              ) : null}
              <span className="min-w-[2em] truncate">{shop.name}</span>
            </Link>
            {recoveryLabel ? (
              <a
                href={recoveryHref}
                className="inline-flex min-h-11 min-w-0 items-center text-base text-muted underline-offset-4 hover:underline"
              >
                {recoveryLabel}
              </a>
            ) : null}
          </div>
        }
        trailing={
          /* The nav rides in the trailing cluster rather than the bar's centre
           slot: on a diver's page the destinations and language control are one
           group — which page, in which words — and both belong at the edge the
           shop's name is not at. The centre slot would have put them between
           the name and the picker, which on a phone is the arrangement that
           squeezes the name from both sides. */
          <>
            <PublicShopNav
              ariaLabel={navAriaLabel}
              items={navItems}
              action={
                <LanguagePicker
                  current={locale}
                  currentLabel={localeLabel}
                  choices={languages}
                  setLocale={setLocale}
                  copy={languagePickerCopy}
                />
              }
            />
            <PublicShopHeaderHeight />
          </>
        }
      />
    </>
  );
}

export function PublicShopFooter({
  shop,
  spokenLanguagesLine,
  deskHoursLine = null,
  whatsAppHref = null,
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
  };
  /**
   * Pre-formatted, already-joined ("Deutsch, 日本語"), or null when no active
   * staff member has recorded a language (issue #708). Named in each
   * language's own endonym, not the reader's locale — the whole point is
   * that a diver recognises their own language among the shop's, whatever
   * language the page itself renders in.
   */
  spokenLanguagesLine: string | null;
  /**
   * "Desk open 7:00 to 17:00", already worded, or null until the shop has
   * saved its hours: the default is a guess for after-hours pings, never a
   * promise to print (`shops.desk_hours_confirmed_at`).
   */
  deskHoursLine?: string | null;
  /** The shop's own WhatsApp sender as a wa.me link, or null when it has none. */
  whatsAppHref?: string | null;
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
  // Built above the JSX rather than nested in it: `check:copy` reads a ternary
  // chain inside an element as prose, and this one is three deep.
  const addressNode =
    addressLines.length === 0 ? null : mapQuery ? (
      <a
        href={openMapsUrl(mapQuery)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${tapTargetLinkClass} hover:text-foreground hover:underline`}
      >
        {addressText}
      </a>
    ) : (
      // On file, but not enough to point a map at a real place — a country and
      // a shop name would centre on a continent and present it as the front
      // door. The words still help; the link would not. From `sm` up they
      // take the 44px line a link would, so when they are the contact row's
      // only words they sit level with the shop's name, not 12px above it.
      <span className="sm:inline-flex sm:min-h-11 sm:items-center">{addressText}</span>
    );

  // **Every link down here is a 44px target** (`tapTargetLinkClass`), and the
  // footer is laid out around that box rather than around the 20px word: the
  // address, phone, email and credit were bare text links a thumb had to hit
  // at 20px (the pixel probe, every storefront page). The boxes carry their own
  // air, so the credit drops its `mt-1` and the contact row its row gap, and
  // from `sm` up the shop's name takes the same 44px line so the contact row
  // beside it does not sit 12px lower.
  return (
    <footer className="border-t border-border bg-surface print:break-inside-avoid">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-start sm:justify-between sm:px-6 print:py-2 print:[&_a]:min-h-0 print:[&_p]:min-h-0 print:[&_span]:min-h-0">
        <div>
          <p className="sm:flex sm:min-h-11 sm:items-center">
            {t("shopChrome.footerLine", { shop: shop.name })}
          </p>
          {/* The credit line — the only DiveDay-coloured pixels on a shop's
              storefront (Harbor, ADR 20260901-diveday-reimagined). */}
          <Link
            href="/"
            className={`${tapTargetLinkClass} gap-1.5 hover:text-foreground print:hidden`}
          >
            <LogoMark className="size-4" />
            <span>{t("shopChrome.credit")}</span>
          </Link>
          {spokenLanguagesLine ? (
            <p>{t("shopChrome.spokenLanguages", { languages: spokenLanguagesLine })}</p>
          ) : null}
          {deskHoursLine ? <p>{deskHoursLine}</p> : null}
        </div>
        {/* Only when there is a way to reach the shop on file. A shop still
            being set up has none, and the empty line took the phone column's
            8px gap under the credit line (the pixel probe,
            public-schedule-new-shop). */}
        {addressNode || shop.contactPhone || shop.contactEmail || whatsAppHref ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0">
            {addressNode}
            {shop.contactPhone ? (
              <a
                href={telHref(shop.contactPhone)}
                className={`${tapTargetLinkClass} hover:text-foreground hover:underline`}
              >
                {shop.contactPhone}
              </a>
            ) : null}
            {shop.contactEmail ? (
              <a
                href={mailtoHref(shop.contactEmail)}
                className={`${tapTargetLinkClass} hover:text-foreground hover:underline`}
              >
                {shop.contactEmail}
              </a>
            ) : null}
            {/* The shop's own WhatsApp Business number, where a diver's
                message lands in the shop's Inbox like any other. */}
            {whatsAppHref ? (
              <a
                href={whatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                className={`${tapTargetLinkClass} hover:text-foreground hover:underline`}
              >
                {t("shopChrome.whatsApp")}
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    </footer>
  );
}
