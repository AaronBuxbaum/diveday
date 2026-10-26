import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/** An authorized setup link opens the form; closed entries redirect to Get set up. */
export default function OnboardLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback compactMobile />
      <EntryShellSkeleton
        eyebrow
        width="lg"
        description={false}
        fields={[
          "shopName",
          "shopSlug",
          "timezone",
          "boat",
          "departure",
          "ownerName",
          "ownerEmail",
          "ownerPassword",
        ]}
      />
      <MarketingFooterFallback />
    </div>
  );
}
