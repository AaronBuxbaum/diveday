import Link from "next/link";
import { FunnelTag } from "@/components/FunnelTag";
import { Wordmark } from "@/components/Logo";
import { MarketingNavLinks } from "@/components/MarketingNavLinks";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { staffShopRoot } from "@/lib/staff-destinations";

/**
 * The marketing header's markup, with the session already resolved to one
 * value: the signed-in staffer's shop slug, or null.
 *
 * It lives apart from `MarketingNav` so it can be rendered in a unit test.
 * Its sibling reads `auth()`, which drags `better-auth` (and `next/server`) into
 * whatever imports it — unloadable under jsdom — so a test of "what does the
 * CTA slot say" could not reach the markup at all while the two shared a file.
 * `demoAction` (`enterDemoAction` from `@/app/actions/demo`) is a prop for the
 * same reason: that module imports `better-auth` too, so `MarketingNav` passes
 * the function down rather than this file importing it directly.
 */
export function MarketingNavView({
  shopSlug,
  locale,
  compactMobile = false,
  pending = false,
  demoAction,
}: {
  /**
   * The signed-in staffer's own shop, or null when nobody is signed in. It is
   * the session's slug — never a route param — so the "Go to shop" link can
   * only ever point at the tenant this browser is actually authenticated for.
   */
  shopSlug: string | null;
  locale: DiverLocale;
  /**
   * The onboard artboard keeps only the wordmark in the phone header, and it
   * keeps it for as long as the full header would take two rows (below lg), so
   * /onboard never opens on the 132px two-row header. It keeps the `px-6`
   * gutter every marketing header and the page column under it sit on; a
   * `px-5` here put the wordmark 4px left of both (K-245).
   */
  compactMobile?: boolean;
  /** Static navigation placeholder: the menu must wait for the resolved header. */
  pending?: boolean;
  // i18n-exempt: type annotation, not copy.
  demoAction: (formData: FormData) => void | Promise<void>;
}) {
  const t = diverTranslator(locale);
  const links = [
    { href: "/product", label: t("nav.product") },
    { href: "/pricing", label: t("nav.pricing") },
    { href: "/switching", label: t("nav.switch") },
    { href: "/about", label: t("nav.about") },
  ];

  return (
    <header
      className={`bg-background/95 ${compactMobile ? "border-b-0 lg:border-b lg:border-border" : "border-b border-border"}`}
    >
      <nav
        aria-label={t("nav.mainNavigation")}
        className={`relative mx-auto flex w-full max-w-7xl items-center gap-2 px-6 py-3 lg:gap-4 ${compactMobile ? "max-lg:h-[52px] max-lg:flex-nowrap max-lg:py-0" : ""}`}
      >
        <Wordmark href="/" className="text-foreground" />
        <MarketingNavLinks
          links={shopSlug ? links : [...links, { href: "/sign-in", label: t("nav.signIn") }]}
          menuLabel={t("nav.menu")}
          compactMobile={compactMobile}
          pending={pending}
        />
        {/* One CTA slot, two audiences. Somebody already signed in cannot try
            the demo or start a trial — they have a shop — so the slot becomes
            the door back to it. Every marketing page carries it, the funnel's
            own pages included (visual review 2026-10-24, B43). */}
        {shopSlug ? (
          <Link
            href={staffShopRoot(shopSlug)}
            className={buttonClass({
              variant: "outline",
              className: `ml-auto whitespace-nowrap print:hidden lg:ml-0 ${compactMobile ? "max-lg:hidden" : ""}`,
            })}
          >
            {t("nav.goToShop")}
          </Link>
        ) : (
          // The demo leads everywhere in the funnel (docs/product/marketing.md,
          // "The two doors, and which one leads"); the nav is a single door,
          // not the pair `FunnelCtas` renders, so it carries that same door
          // rather than the trial it used to. Secondary weight: each marketing
          // page carries its own primary CTA, and two competing primaries on
          // first paint was a real "what do I click?" cost (design review).
          <form
            action={demoAction}
            className={`ml-auto print:hidden lg:ml-0 ${compactMobile ? "max-lg:hidden" : ""}`}
          >
            <FunnelTag source="nav" />
            <SubmitButton
              pendingLabel={t("nav.gettingReady")}
              className={buttonClass({
                variant: "outline",
                busy: true,
                className: "whitespace-nowrap",
              })}
            >
              <span className="lg:hidden" aria-hidden="true">
                {t("nav.tryDemoShort")}
              </span>
              <span className="hidden lg:inline" aria-hidden="true">
                {t("nav.tryDemo")}
              </span>
              <span className="sr-only">{t("nav.tryDemo")}</span>
            </SubmitButton>
          </form>
        )}
      </nav>
    </header>
  );
}
