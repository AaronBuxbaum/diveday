import Link from "next/link";
import { homeDiverDoorEnabled } from "@/features/home-diver-door";
import type { DiverTranslator } from "@/i18n/messages";
import { FIND_YOUR_BOOKING_PATH } from "@/lib/public-routes";

/**
 * **The one line for a diver** under the home hero (fourth review, item 50).
 * Every shop footer says "Bookings by DiveDay" and links here, so a diver who
 * lost their link lands on a page for shop owners. A sentence, not a button:
 * the hero's one primary and one secondary stay the shop's, and this is a way
 * through, not a pitch. The terms under the doors are `FunnelCtas`'s
 * `footnotes`.
 *
 * **It waits behind `HOME_DIVER_DOOR`** (Aaron, 2026-11-11, #4313): the page it
 * opens is empty until a shop is listed, and a shop owner who followed the
 * line read "No shops are listed yet" one click from the headline. The switch
 * is read here, per deployment, so the cached home body needs no prop for it.
 */
export function DiverDoor({ t }: { t: DiverTranslator }) {
  if (!homeDiverDoorEnabled()) return null;
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
