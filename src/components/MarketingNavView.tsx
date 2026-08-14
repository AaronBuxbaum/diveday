import Link from "next/link";
import { Wordmark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { trialHref } from "@/lib/funnel";
import { staffShopRoot } from "@/lib/staff-destinations";

const navLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-200 hover:text-foreground sm:px-3";

/**
 * The marketing header's markup, with the session already resolved to one
 * value: the signed-in staffer's shop slug, or null.
 *
 * It lives apart from `MarketingNav` so it can be rendered in a unit test.
 * Its sibling reads `auth()`, which drags `next-auth` (and `next/server`) into
 * whatever imports it — unloadable under jsdom — so a test of "what does the
 * CTA slot say" could not reach the markup at all while the two shared a file.
 */
export function MarketingNavView({
  shopSlug,
  locale,
  hideTrialCta,
}: {
  /**
   * The signed-in staffer's own shop, or null when nobody is signed in. It is
   * the session's slug — never a route param — so the "Go to shop" link can
   * only ever point at the tenant this browser is actually authenticated for.
   */
  shopSlug: string | null;
  locale: DiverLocale;
  hideTrialCta: boolean;
}) {
  const t = diverTranslator(locale);
  const links = [
    { href: "/product", label: t("nav.product") },
    { href: "/pricing", label: t("nav.pricing") },
    { href: "/switching", label: t("nav.switch") },
    { href: "/about", label: t("nav.about") },
  ];

  return (
    <header className="border-b border-border bg-background/95">
      {/*
       * Phone layout is two deliberate rows — brand + trial CTA first, page
       * links second — rather than free wrapping, which used to stack the
       * link block *above* the logo and read as a broken header on the very
       * first paint. ≥sm it collapses back to the familiar single row.
       */}
      <nav
        aria-label={t("nav.mainNavigation")}
        className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 sm:flex-nowrap"
      >
        <Wordmark href="/" className="text-foreground" />
        <div className="order-3 -mx-2 flex basis-full flex-wrap items-center gap-x-1 sm:order-none sm:mx-0 sm:ml-auto sm:basis-auto sm:justify-end sm:gap-x-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClassName}>
              {link.label}
            </Link>
          ))}
          {/* Signing out is a staff act, and it belongs on the staff header
              where the shop's own nav lives — not on a public page whose job
              is to explain the product. A signed-in visitor here is browsing
              marketing, and the only thing they want from this bar is the way
              back in, which the CTA slot below now is. */}
          {shopSlug ? null : (
            <Link href="/sign-in" className={navLinkClassName}>
              {t("nav.signIn")}
            </Link>
          )}
        </div>
        {/* One CTA slot, two audiences. Somebody already signed in cannot start
            a trial — they have a shop — so the slot becomes the door back to
            it. `hideTrialCta` suppresses only the *trial* pitch (it is set on
            /onboard, where starting one is the page's whole job); the way back
            to your own shop is wayfinding, never a pitch, so it still shows. */}
        {shopSlug ? (
          <Link
            href={staffShopRoot(shopSlug)}
            className={buttonClass({
              variant: "secondary",
              className: "ml-auto font-semibold whitespace-nowrap sm:ml-0",
            })}
          >
            {t("nav.goToShop")}
          </Link>
        ) : hideTrialCta ? null : (
          <Link
            href={trialHref("nav")}
            className={buttonClass({
              // Secondary weight: each marketing page carries its own primary
              // CTA, and two competing primaries on first paint was a real
              // "what do I click?" cost (design review). The nav keeps the
              // trial reachable from anywhere without shouting over the page.
              variant: "secondary",
              className: "ml-auto font-semibold whitespace-nowrap sm:ml-0",
            })}
          >
            {t("nav.startTrial")}
          </Link>
        )}
      </nav>
    </header>
  );
}
