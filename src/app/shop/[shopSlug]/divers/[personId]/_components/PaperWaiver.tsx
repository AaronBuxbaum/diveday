import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { SectionCard } from "@/components/ui/card";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { markWaiverInPersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

function statusToneClass(
  state: DiverProfile["waiver"]["state"],
  requestStatus: DiverProfile["waiverRequest"],
) {
  if (state === "current") return "border-success/40 bg-success/5";
  if (state === "medical_review" || requestStatus === "failed") {
    return "border-danger/40 bg-danger/5";
  }
  return "border-warning/40 bg-warning/5";
}

function waiverStatusCopy(
  diver: DiverProfile,
  t: StaffTranslator,
  locale: string,
  timezone: string,
) {
  const date = (value: Date) => formatCalendarDate(calendarDateInTimezone(value, timezone), locale);
  if (diver.waiver.state === "current") {
    return {
      label: t("divers.stats.waiverSigned"),
      detail: t("divers.stats.waiverGoodUntil", { date: date(diver.waiver.expiresAt) }),
    };
  }
  if (diver.waiver.state === "medical_review") {
    return {
      label: t("divers.stats.waiverMedicalReview"),
      detail: t("divers.stats.waiverHeldSince", { date: date(diver.waiver.at) }),
    };
  }
  if (diver.waiver.state === "expired") {
    return {
      label: t("divers.stats.waiverNotSigned"),
      detail: t("divers.stats.waiverLastSigned", { date: date(diver.waiver.signedAt) }),
    };
  }
  if (diver.waiverRequest === "failed") {
    return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverFailed") };
  }
  if (diver.waiverRequest === "not_signed") {
    return { label: t("divers.stats.waiverNotSigned"), detail: null };
  }
  return { label: t("divers.stats.waiverNotSigned"), detail: null };
}

/** One waiver card for status, delivery actions, private-link copying, and paper signatures. */
export function PaperWaiver({
  diver,
  shopSlug,
  personId,
  locale,
  status,
  timezone,
  compact = false,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  /** This form's own outcome, rendered inside the card rather than page-top. */
  status?: DiverNotice;
  /** Render as one of the diver record's top-line stat cards. */
  compact?: boolean;
}) {
  const t = staffTranslator(locale);
  const state = waiverStatusCopy(diver, t, locale, timezone);
  const needsAction = diver.waiver.state === "none" || diver.waiver.state === "expired";
  const bookingIds = diver.bookings
    .filter(
      ({ booking, trip }) =>
        trip.status === "scheduled" && booking.status !== "cancelled" && trip.startsAt >= nowDate(),
    )
    .map(({ booking }) => booking.id);
  const firstBooking = diver.bookings.find(({ booking }) => bookingIds.includes(booking.id));

  const content = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className={compact ? "mt-1 text-2xl font-semibold" : "text-lg font-semibold"}>
          {state.label}
        </p>
        {state.detail ? <p className="text-sm text-muted">{state.detail}</p> : null}
      </div>
      {!compact && needsAction ? (
        <div className="flex w-full flex-wrap items-start gap-2">
          {bookingIds.length > 0 ? (
            <WaiverSendControl
              shopSlug={shopSlug}
              surface="roster"
              tripId={firstBooking?.trip.id}
              bookingIds={bookingIds}
              label={t("divers.stats.waiverSend")}
              exposeLink
              wrapperClassName=""
              copy={waiverSendCopy(t)}
            />
          ) : null}
          <PaperWaiverControl
            action={markWaiverInPersonAction.bind(null, shopSlug, personId)}
            t={t}
            className="w-full sm:w-auto"
          />
        </div>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <div
        className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${statusToneClass(
          diver.waiver.state,
          diver.waiverRequest,
        )}`}
      >
        <p className="text-sm text-muted">{t("divers.stats.waiver")}</p>
        {content}
        {needsAction ? (
          <div className="mt-3 flex w-full flex-wrap items-start gap-2">
            {bookingIds.length > 0 ? (
              <WaiverSendControl
                shopSlug={shopSlug}
                surface="roster"
                tripId={firstBooking?.trip.id}
                bookingIds={bookingIds}
                label={t("divers.stats.waiverSend")}
                exposeLink
                wrapperClassName=""
                copy={waiverSendCopy(t)}
              />
            ) : null}
            <PaperWaiverControl
              action={markWaiverInPersonAction.bind(null, shopSlug, personId)}
              t={t}
              className="w-full sm:w-auto"
            />
          </div>
        ) : null}
        <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
      </div>
    );
  }

  return (
    <SectionCard
      className={`mt-3 ${statusToneClass(diver.waiver.state, diver.waiverRequest)}`}
      title={t("divers.stats.waiver")}
    >
      {content}
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
    </SectionCard>
  );
}
