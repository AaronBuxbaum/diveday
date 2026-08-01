import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { DEFAULT_DIVER_LOCALE, type DiverLocale } from "@/i18n/settings";
import { auth, signOut } from "@/lib/auth";
import { trialHref } from "@/lib/funnel";

const navLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-200 hover:text-foreground sm:px-3";

async function signOutToSignInAction() {
  "use server";
  await signOut({ redirectTo: "/sign-in" });
}

/**
 * Reads the session (`auth()`, cookie-backed) and the negotiated locale
 * (`headers()`-backed) — both genuinely per-request and never cacheable, so
 * this stays a plain dynamic Server Component. A marketing page that hoists
 * its own body into a `"use cache"` function (per-locale, no session) wraps
 * this in its own `<Suspense>` with {@link MarketingNavFallback} instead of
 * nesting it inside the cached scope — see the marketing pages under
 * `src/app`.
 */
export async function MarketingNav() {
  const session = await auth();
  const locale = await requestLocale();
  return <MarketingNavView signedIn={Boolean(session)} locale={locale} />;
}

/**
 * The static shell's stand-in for {@link MarketingNav} while the real,
 * session-aware nav streams in: the default locale, signed out — correct for
 * the overwhelming majority of marketing-page visitors (anonymous, no
 * session), and what actually renders for them with zero streaming delay.
 */
export function MarketingNavFallback() {
  return <MarketingNavView signedIn={false} locale={DEFAULT_DIVER_LOCALE} />;
}

function MarketingNavView({ signedIn, locale }: { signedIn: boolean; locale: DiverLocale }) {
  const t = diverTranslator(locale);
  const links = [
    { href: "/product", label: t("nav.product") },
    { href: "/pricing", label: t("nav.pricing") },
    { href: "/switching", label: t("nav.switch") },
    { href: "/about", label: t("nav.about") },
  ];

  return (
    <header className="border-b border-border bg-background/95">
      <nav
        aria-label={t("nav.mainNavigation")}
        className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4"
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
        >
          <LogoMark className="size-6 text-primary" />
          {/* i18n-exempt: brand name */}
          <span>
            DiveDay<span className="text-primary">.</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-5">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={navLinkClassName}>
              {link.label}
            </Link>
          ))}
          {signedIn ? (
            <form action={signOutToSignInAction}>
              <button type="submit" className={navLinkClassName}>
                {t("nav.signOut")}
              </button>
            </form>
          ) : (
            <Link href="/sign-in" className={navLinkClassName}>
              {t("nav.signIn")}
            </Link>
          )}
          <Link
            href={trialHref("nav")}
            className={buttonClass({ className: "font-semibold whitespace-nowrap" })}
          >
            {t("nav.startTrial")}
          </Link>
        </div>
      </nav>
    </header>
  );
}
