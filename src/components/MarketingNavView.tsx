import Link from "next/link";
import { FunnelTag } from "@/components/FunnelTag";
import { Wordmark } from "@/components/Logo";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { staffShopRoot } from "@/lib/staff-destinations";

const navLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted transition-colors hover:text-foreground lg:px-3";

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
  hideCta,
  compactMobile = false,
  demoAction,
}: {
  /**
   * The signed-in staffer's own shop, or null when nobody is signed in. It is
   * the session's slug — never a route param — so the "Go to shop" link can
   * only ever point at the tenant this browser is actually authenticated for.
   */
  shopSlug: string | null;
  locale: DiverLocale;
  hideCta: boolean;
  /**
   * The onboard artboard keeps only the wordmark in the phone header, and it
   * keeps it for as long as the full header would take two rows (below lg), so
   * /onboard never opens on the 132px two-row header. It keeps the `px-6`
   * gutter every marketing header and the page column under it sit on; a
   * `px-5` here put the wordmark 4px left of both (K-245).
   */
  compactMobile?: boolean;
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
  // The CTA slot renders nothing for a signed-out visitor on a page that hides
  // the pitch (/dive, /onboard). With no CTA after it, the row's last link ends
  // its word `lg:px-3` short of the gutter the footer and the CTA end on, so
  // the row hangs that padding into the gutter, as `-mx-2` does on a phone
  // (K-512). With a CTA the padding is the gap before it and stays.
  const ctaSlotEmpty = !shopSlug && hideCta;

  return (
    <header
      className={`bg-background/95 ${compactMobile ? "border-b-0 lg:border-b lg:border-border" : "border-b border-border"}`}
    >
      {/*
       * Phone layout is two deliberate rows — brand + CTA first, page links
       * second — rather than free wrapping, which used to stack the link
       * block *above* the logo and read as a broken header on the very first
       * paint. ≥lg it collapses back to the familiar single row. Not ≥sm: the
       * row needs about 669px in en-US and at 640 the bar has 592, so the
       * links wrapped into a block of their own up to 716 (K-88). Not ≥md
       * either: es-ES needs about 837px ("Quiénes somos", "Iniciar sesión",
       * "Probar la demo en vivo"), so at md's 720 the same block came back up
       * to 884. lg's 976 holds both diver locales.
       */}
      <nav
        aria-label={t("nav.mainNavigation")}
        className={`mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 lg:flex-nowrap ${compactMobile ? "max-lg:h-[52px] max-lg:flex-nowrap max-lg:py-0" : ""}`}
      >
        <Wordmark href="/" className="text-foreground" />
        <div
          className={`order-3 -mx-2 flex basis-full flex-wrap items-center gap-x-1 lg:order-none lg:mx-0 lg:ml-auto lg:basis-auto lg:justify-end lg:gap-x-2 ${ctaSlotEmpty ? "lg:-me-3" : ""} ${compactMobile ? "max-lg:hidden" : ""}`}
        >
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
        {/* One CTA slot, two audiences. Somebody already signed in cannot try
            the demo or start a trial — they have a shop — so the slot becomes
            the door back to it. `hideCta` suppresses only the pitch (it is
            set on /onboard, whose footer already offers the demo and whose
            form is the trial itself); the way back to your own shop is
            wayfinding, never a pitch, so it still shows. */}
        {shopSlug ? (
          <Link
            href={staffShopRoot(shopSlug)}
            className={buttonClass({
              variant: "outline",
              className: `ml-auto whitespace-nowrap lg:ml-0 ${compactMobile ? "max-lg:hidden" : ""}`,
            })}
          >
            {t("nav.goToShop")}
          </Link>
        ) : ctaSlotEmpty ? null : (
          // The demo leads everywhere in the funnel (docs/product/marketing.md,
          // "The two doors, and which one leads"); the nav is a single door,
          // not the pair `FunnelCtas` renders, so it carries that same door
          // rather than the trial it used to. Secondary weight: each marketing
          // page carries its own primary CTA, and two competing primaries on
          // first paint was a real "what do I click?" cost (design review).
          <form
            action={demoAction}
            className={`ml-auto lg:ml-0 ${compactMobile ? "max-lg:hidden" : ""}`}
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
              {t("nav.tryDemo")}
            </SubmitButton>
          </form>
        )}
      </nav>
    </header>
  );
}
