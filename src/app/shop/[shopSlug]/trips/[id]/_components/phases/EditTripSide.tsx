import Link from "next/link";
import { AutoOpenDetails } from "@/components/AutoOpenDetails";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { FormStatus } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { tripPacketPath } from "@/lib/print-sheets";
import { type FormNotice, shopPath } from "@/lib/staff-notices";
import { cancelTripAction } from "../../details-actions";
import { recordTripPrintPdfAction } from "../../print-actions";
import { BlowoutDoors } from "../BlowoutDoors";
import { PrintTripBundleButton } from "../PrintTripBundleButton";

const CARD = sectionCardClass({ padding: "none" });
const HEADING = "px-4 pt-4 font-semibold sm:px-5 sm:pt-5";
const LINK = buttonClass({ variant: "link", flush: true });

/**
 * **Repeats**, one line (ADR 20261117-trip-page-clock): the run's cadence and
 * the door to the series page under Schedule, where the run is changed or
 * called off. A one-time trip says so and has no door.
 */
export function RepeatsCard({
  line,
  href,
  t,
}: {
  line: string;
  /** The series page, to a staffer who may change the run; null otherwise. */
  href: string | null;
  t: StaffTranslator;
}) {
  return (
    <section id="series" aria-labelledby="edit-repeats" className={`${CARD} scroll-mt-24`}>
      <h3 id="edit-repeats" className={HEADING}>
        {t("trips.about.repeats")}
      </h3>
      <div className="flex items-baseline justify-between gap-4 px-4 pt-2 pb-4 sm:px-5 sm:pb-5">
        <p className="min-w-0">{line}</p>
        {href ? (
          <Link href={href} className={`${LINK} shrink-0`}>
            {t("trips.clock.edit.schedule")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/**
 * **Print**: the trip packet (recorded on the trail), and the doors to the
 * three papers drawn where their subject is: paper-pass navigation in Getting ready, the rental tickets on Gear, and the roll call on Roll call.
 */
export function PrintCard({
  shopSlug,
  tripId,
  t,
}: {
  shopSlug: string;
  tripId: string;
  t: StaffTranslator;
}) {
  const trip = shopPath(shopSlug, "trips", tripId);
  return (
    <section aria-labelledby="edit-print" className={CARD}>
      <h3 id="edit-print" className={HEADING}>
        {t("trips.clock.edit.print")}
      </h3>
      <div className="flex flex-wrap gap-x-8 gap-y-2 px-4 pt-2 pb-4 sm:px-5 sm:pb-5">
        <PrintTripBundleButton
          href={tripPacketPath(shopSlug, tripId)}
          label={t("trips.clock.edit.tripPacket")}
          popupBlockedLabel={t("shared.printButton.popupBlocked")}
          recordAction={recordTripPrintPdfAction.bind(null, shopSlug, tripId)}
          flush
          link
        />
        <Link href={`${trip}?phase=ready`} className={LINK}>
          {t("trips.clock.edit.paperPasses")}
        </Link>
        <Link href={`${trip}/prep`} className={LINK}>
          {t("trips.clock.edit.rentalTickets")}
        </Link>
        <Link href={`${trip}/manifest`} className={LINK}>
          {t("trips.clock.edit.paperRollCall")}
        </Link>
      </div>
    </section>
  );
}

/**
 * **Call it off**, last: the weather call for this boat (and, to the roles
 * that may, the whole day), then cancelling the trip behind its own confirm.
 * The same doors and actions as before; only while the trip may still change.
 */
export function CallOffCard({
  shop,
  personId,
  tripId,
  startsAt,
  lifecycleStatus,
  t,
}: {
  shop: { id: string; slug: string; timezone: string };
  personId: string;
  tripId: string;
  startsAt: Date;
  lifecycleStatus: FormNotice | undefined;
  t: StaffTranslator;
}) {
  return (
    <section
      id="call-off"
      aria-label={t("trips.clock.edit.callOff")}
      className={`${CARD} scroll-mt-24`}
    >
      {/* **One quiet door at rest** (design review of the final screens, finding
          12): the weather call, the day's and cancelling are destructive, so
          they wait behind "Call it off…"; an answer arrives with it open. */}
      <AutoOpenDetails
        openOnHash="call-off"
        open={Boolean(lifecycleStatus?.text)}
        className="group/calloff"
      >
        <summary
          data-call-off-open=""
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 font-semibold sm:px-5 [&::-webkit-details-marker]:hidden"
        >
          {t("trips.clock.edit.callOffMore")}
          <DisclosureCaret direction="down" className="size-4 group-open/calloff:rotate-180" />
        </summary>
        <div className="flex flex-col items-start gap-2 px-4 pb-4 sm:px-5">
          <FormStatus tone={lifecycleStatus?.tone} className="mb-2">
            {lifecycleStatus?.text}
          </FormStatus>
          <BlowoutDoors
            shop={shop}
            personId={personId}
            tripId={tripId}
            startsAt={startsAt}
            tripLabel={t("trips.detail.weatherBlowout")}
            dayLabel={t("trips.detail.dayBlowout")}
          />
          <form action={cancelTripAction.bind(null, shop.slug, tripId)} className="w-full">
            <InlineConfirm
              triggerLabel={t("trips.about.cancel")}
              message={t("trips.detail.cancelHint")}
              confirmLabel={t("trips.detail.cancelConfirm")}
              cancelLabel={t("words.dismiss.neverMind")}
              pendingLabel={t("words.busy.canceling")}
              triggerClassName={buttonClass({ variant: "danger-ghost", flush: true })}
              confirmClassName={buttonClass({ variant: "danger", size: "sm" })}
            />
          </form>
        </div>
      </AutoOpenDetails>
    </section>
  );
}
