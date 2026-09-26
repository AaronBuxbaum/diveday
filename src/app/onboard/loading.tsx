import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * Entry-shell-shaped skeleton for `/onboard` (design principle 1), while the
 * page reads its `searchParams` and the negotiated locale.
 *
 * **It draws the door the route renders by default** (K-290): without the
 * setup key the page is `ClosedDoor` — the marketing header, then an eyebrow,
 * a title that wraps to two lines on a phone, a panel holding one two-line
 * sentence and the mail button, two footer sentences (the first wraps), and
 * the marketing footer. It drew the six-field trial form, with no chrome,
 * and collapsed about 440px into the closed door on every visit. A visitor
 * with the key sees the form arrive under the same header, as it did before.
 */
export default function OnboardLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback hideCta compactMobile />
      <EntryShellSkeleton
        eyebrow
        titleLines={{ base: 2, sm: 1 }}
        description={false}
        body={2}
        footnote={[2, 1]}
      />
      <MarketingFooterFallback />
    </div>
  );
}
