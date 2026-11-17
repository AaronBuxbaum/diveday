import { EntryShell } from "@/components/account/EntryShell";
import { MarketingFooterFallback } from "@/components/MarketingFooter";

/**
 * Entry-shell-shaped skeleton for `/get-set-up` while it reads the locale and
 * `?from=`: a wordmark, a title and its four lines of what happens next, the
 * form's boxes, one sign-in sentence, and the footer.
 */
export default function GetSetUpLoading() {
  return (
    <div className="flex flex-1 flex-col">
      <EntryShell
        pending
        wordmark
        descriptionLines={{ base: 6, sm: 4 }}
        fields={["shopName", "region", "runs", "currentSystem", "contactName", "email", "phone"]}
      />
      <MarketingFooterFallback />
    </div>
  );
}
