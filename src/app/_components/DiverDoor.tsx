import Link from "next/link";
import type { DiverTranslator } from "@/i18n/messages";
import { FIND_YOUR_BOOKING_PATH } from "@/lib/public-routes";

/**
 * **The one line for a diver** under the home hero (fourth review, item 50).
 * Every shop footer says "Bookings by DiveDay" and links here, so a diver who
 * lost their link lands on a page for shop owners. A sentence, not a button:
 * the hero's one primary and one secondary stay the shop's, and this is a way
 * through, not a pitch. The terms under the doors are `FunnelCtas`'s
 * `footnotes`.
 */
export function DiverDoor({ t }: { t: DiverTranslator }) {
  return (
    <p className="mt-6 text-sm text-muted">
      {t("marketing.home.diverDoor")}{" "}
      <Link
        href={FIND_YOUR_BOOKING_PATH}
        className="font-medium text-primary underline-offset-4 hover:underline"
      >
        {t("marketing.home.diverDoorLink")}
      </Link>
    </p>
  );
}
