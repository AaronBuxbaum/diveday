import Link from "next/link";
import { MoreMenu } from "@/components/MoreMenu";
import { buttonClass } from "@/components/ui/button";
// `instant = true` asserts that navigating *into* this page paints
// immediately — this segment's `loading.tsx`, with no request read above it.
// Since the staff shell became synchronous (issue 1446) that holds for a cold,
// direct visit too: the shell's session, shop row and nav stream in beside the
// page from `ShopChrome` rather than above it, so the route gets a static
// shell and its own reads are the only ones the reader waits on. See ADR
// 20260804-instant-navigation.
import type { StaffTranslator } from "@/i18n/staff-messages";
import { publicTripPath } from "@/lib/public-routes";
import { shopPath } from "@/lib/staff-notices";
import { recordTripPrintPdfAction } from "../print-actions";
import { CopyLinkButton } from "./CopyLinkButton";
import { DepartureLogLink } from "./DepartureLogLink";
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
  // Everything after Copy link: one row from `md`; below it, one "More"
  // menu, so no door wraps onto a line of its own under the others (visual
  // review 2026-10-24, A36: "Departure log" sat alone under three).
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
        href={shopPath(shopSlug, "trips", tripId, "print")}
        label={t("trips.about.printPacket")}
        popupBlockedLabel={t("shared.printButton.popupBlocked")}
        recordAction={recordTripPrintPdfAction.bind(null, shopSlug, tripId)}
        flush
      />
      <PrintWithMedicalAlertsLink shop={shop} personId={personId} tripId={tripId} />
      <DepartureLogLink shop={shop} personId={personId} tripId={tripId} />
    </>
  );
  return (
    <>
      {/* All flush, so whichever starts a line puts its word on the panel's
      column; the row's gap hands back what they gave up (TripAboutSection). */}
      <CopyLinkButton
        path={publicTripPath(shopSlug, tripId)}
        label={t("trips.detail.copyBookingLink")}
        copiedLabel={t("trips.detail.linkCopied")}
        failedLabel={t("trips.detail.linkCopyFailed")}
        flush
      />
      <div className="hidden md:contents">{rest}</div>
      <MoreMenu label={t("trips.about.moreDoors")} size="sm" className="md:hidden">
        <div className="flex flex-col px-2 [&_a]:w-full [&_a]:justify-start [&_button]:w-full [&_button]:justify-start">
          {rest}
        </div>
      </MoreMenu>
    </>
  );
}
