import Link from "next/link";
import { LogoMark } from "@/components/Logo";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2">
          <LogoMark className="size-4 shrink-0 text-primary" />
          <span>
            <span className="font-semibold text-foreground">DiveDay.</span> A calmer way to run a
            dive day.
          </span>
        </p>
        <div className="flex gap-4">
          <Link href="/product" className="hover:text-foreground hover:underline">
            Product
          </Link>
          <Link href="/pricing" className="hover:text-foreground hover:underline">
            Pricing
          </Link>
          <Link href="/switching" className="hover:text-foreground hover:underline">
            Switch
          </Link>
          <Link href="/sign-in" className="hover:text-foreground hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
