import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import type { StaffTranslator } from "@/i18n/staff-messages";
import { tripPacketPath } from "@/lib/print-sheets";
import { publicTripPath } from "@/lib/public-routes";
import { recordTripPrintPdfAction } from "../print-actions";
import { CopyLinkButton } from "./CopyLinkButton";
import { OverflowActions } from "./OverflowActions";
import { PrintTripBundleButton } from "./PrintTripBundleButton";
import { PrintWithMedicalAlertsLink } from "./PrintWithMedicalAlertsLink";

/**
 * The About section's links out: copy the public booking link, open the
 * public page, print the packet, and the departure's log where this staffer
 * may read it. All flush, so whichever starts a line puts its word on the
 * panel's column.
 */
export function TripAboutLinks({
  shop,
  personId,
  shopSlug,
  tripId,
  t,
}: {
  shop: { id: string; slug: string; defaultLocale: string };
  /** The signed-in staffer; the log link asks whether they may read it. */
  personId: string;
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  const rest = (
    <>
      <Link
        href={publicTripPath(shopSlug, tripId)}
        target="_blank"
        rel="noreferrer"
        className={buttonClass({ variant: "ghost", size: "sm", flush: true })}
      >
        {t("trips.about.viewPublic")}
      </Link>
      <PrintTripBundleButton
        href={tripPacketPath(shopSlug, tripId)}
        label={t("trips.about.printPacket")}
        popupBlockedLabel={t("shared.printButton.popupBlocked")}
        recordAction={recordTripPrintPdfAction.bind(null, shopSlug, tripId)}
        flush
      />
      <PrintWithMedicalAlertsLink shop={shop} personId={personId} tripId={tripId} />
    </>
  );
  return (
    <OverflowActions
      label={t("trips.about.moreDoors")}
      primary={
        <CopyLinkButton
          path={publicTripPath(shopSlug, tripId)}
          label={t("trips.detail.copyBookingLink")}
          copiedLabel={t("words.did.copied")}
          failedLabel={t("trips.detail.linkCopyFailed")}
          flush
        />
      }
    >
      {rest}
    </OverflowActions>
  );
}
