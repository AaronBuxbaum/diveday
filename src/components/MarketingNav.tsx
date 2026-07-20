import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

const links = [
  { href: "/product", label: "Product" },
  { href: "/pricing", label: "Pricing" },
];

export function MarketingNav() {
  return (
    <header className="border-b border-border bg-background/95">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4"
      >
        <Link href="/" className="text-base font-semibold tracking-tight text-foreground">
          scuba<span className="text-primary">.</span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-5">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <Link href="/onboard" className={buttonClass({ className: "font-semibold" })}>
            Start a trial
          </Link>
        </div>
      </nav>
    </header>
  );
}
