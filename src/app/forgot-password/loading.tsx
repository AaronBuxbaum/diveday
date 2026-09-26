import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * Entry-shell-shaped skeleton for "reset your password" (design principle 1).
 * The page's own words need the negotiated locale (`requestLocale()`, backed
 * by `headers()`) and its sent-state needs `searchParams`, so neither can be
 * in the static shell — this is what a visitor sees the instant the shell
 * lands, instead of a blank page while the request resolves.
 *
 * The page draws `MarketingNav` over its door and `MarketingFooter` under it,
 * so the skeleton does too, the real signed-out, default-locale chrome as
 * `/dive`'s skeleton draws it: without it the door centred in the whole
 * viewport and jumped into the band the chrome leaves when the page landed
 * (K-291).
 */
export default function ForgotPasswordLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback />
      <EntryShellSkeleton fields={["email"]} />
      <MarketingFooterFallback />
    </div>
  );
}
