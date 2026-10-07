import { MarketingNavFallback } from "@/app/_components/MarketingNav";
import { EntryShellSkeleton } from "@/components/account/EntryShellSkeleton";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * Entry-shell-shaped skeleton for `/get-set-up` while it reads the locale and
 * `?from=`: the marketing header, a title and its one-line description, the
 * form's boxes, one sign-in sentence, and the footer.
 */
export default function GetSetUpLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNavFallback hideCta compactMobile />
      <EntryShellSkeleton
        fields={[
          "shopName",
          "region",
          "runsBoat",
          "currentSystem",
          "contactName",
          "email",
          "phone",
        ]}
      />
      <MarketingFooterFallback />
    </div>
  );
}
