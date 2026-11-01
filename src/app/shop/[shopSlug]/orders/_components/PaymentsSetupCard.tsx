import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import { SectionCard } from "@/components/ui/card";

/** Setup card above the ledger; rendered only for readers allowed to manage payment settings (UX audit 2026-10-07, item 20). */
export function PaymentsSetupCard({
  shopSlug,
  title,
  body,
  connectLabel,
}: {
  shopSlug: string;
  title: string;
  body: string;
  connectLabel: string;
}) {
  return (
    <SectionCard
      title={title}
      description={body}
      className="mb-6"
      actions={<PaymentsConnectCta shopSlug={shopSlug} label={connectLabel} />}
    />
  );
}
