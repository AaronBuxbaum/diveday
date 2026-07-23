import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";

const links = [
  { href: "/product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/sign-in", label: "Sign in" },
];

export function MarketingNav() {
  return (
    <header className="border-b border-border bg-background/95">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4"
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground"
        >
          <LogoMark className="size-6 text-primary" />
          <span>
            DiveDay<span className="text-primary">.</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 sm:gap-5">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-lg px-2 py-2 text-sm font-medium whitespace-nowrap text-muted transition-colors duration-200 hover:text-foreground sm:px-3"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/onboard"
            className={buttonClass({ className: "font-semibold whitespace-nowrap" })}
          >
            Start a trial
          </Link>
        </div>
      </nav>
    </header>
  );
}
