import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import { SectionCard } from "@/components/ui/card";

/**
 * **Connecting payments is a setup step, not the page's standing primary**
 * (UX audit 2026-10-07, item 20). An owner does it once; it used to stand in
 * the Money header every day until they did, in the place the page's own act
 * belongs. It is a card above the list now, and the header holds "New order"
 * once there is an account to send one from.
 *
 * Rendered only for a reader who may connect an account
 * (`canPersonManagePaymentSettings`): for anyone else the door would land on a
 * settings page they cannot change.
 */
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
