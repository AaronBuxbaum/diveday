import Link from "next/link";
import { ChromeBar } from "@/components/chrome/ChromeBar";
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
   * The onboard artboard keeps only the wordmark in the phone header (below
   * lg). The bar is one row at every width, so this hides the links and the CTA
   * and nothing else.
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

  const phoneHidden = compactMobile ? "max-lg:hidden" : "";

  return (
    <ChromeBar
      wide
      leading={<Wordmark href="/" className="text-foreground" />}
      trailing={
        <nav
          aria-label={t("nav.mainNavigation")}
          className="flex items-center gap-1.5 sm:gap-2 lg:gap-3"
        >
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
                className: `whitespace-nowrap print:hidden ${phoneHidden}`,
              })}
            >
              {t("nav.goToShop")}
            </Link>
          ) : (
            // The demo leads everywhere in the funnel (docs/product/marketing.md,
            // "The two doors, and which one leads"); the nav is a single door,
            // not the pair `FunnelCtas` renders. Secondary weight: each marketing
            // page carries its own primary CTA, and two competing primaries on
            // first paint was a real "what do I click?" cost (design review).
            <form action={demoAction} className={`print:hidden ${phoneHidden}`}>
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
      }
    />
  );
}
