import Link from "next/link";
import { PaymentsConnectCta } from "@/components/PaymentsConnectCta";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/**
 * **"Connect Stripe before creating a code", where it is true.** It is about
 * creating, so on a shop with codes on its list it sits inside the "New code"
 * door; a page-wide copy stood over a live, redeemed REEF10 and read as if
 * those codes were broken (third review #36). Only a shop with no codes at
 * all, where it is the one next move, shows it at the top of the page.
 */
export function PromoConnectNotice({
  t,
  shopSlug,
  className,
}: {
  t: StaffTranslator;
  shopSlug: string;
  className: string;
}) {
  return (
    <PaymentsConnectCta
      variant="banner"
      className={className}
      message={t.rich("promos.connectBanner", {
        settingsLink: (chunks) => (
          <Link href={shopPath(shopSlug, "settings")} className="font-semibold underline">
            {chunks}
          </Link>
        ),
      })}
    />
  );
}
