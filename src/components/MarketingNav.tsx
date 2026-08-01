import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { auth, signOut } from "@/lib/auth";
import { trialHref } from "@/lib/funnel";

const navLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-200 hover:text-foreground sm:px-3";

async function signOutToSignInAction() {
  "use server";
  await signOut({ redirectTo: "/sign-in" });
}

export async function MarketingNav() {
  const session = await auth();
  const t = diverTranslator(await requestLocale());
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
          {session ? (
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
