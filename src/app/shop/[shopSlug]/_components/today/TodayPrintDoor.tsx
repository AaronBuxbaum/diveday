import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/** The paper day: one document holding every departure of today, as the header's one action. */
export function TodayPrintDoor({ shopSlug, t }: { shopSlug: string; t: StaffTranslator }) {
  return (
    <Link
      // `shopPath`, not a template literal: it escapes each segment, so
      // nobody reading this line has to re-derive that `shopSlug` was
      // already narrowed by `requireShopSurface` upstream.
      href={shopPath(shopSlug, "print")}
      target="_blank"
      rel="noreferrer"
      // The band's own chip, as the trip masthead draws it: a 44px
      // target on the control rung. It was typed out by hand as a
      // 32px pill in a heavier weight (K-152).
      className={buttonClass({
        variant: "secondary",
        size: "sm",
        className: "print:hidden",
      })}
    >
      {t("shared.printPacket.dayDoor")}
    </Link>
  );
}
