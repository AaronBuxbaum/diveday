import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { WaiverSendControl } from "@/app/shop/[shopSlug]/_components/today/WaiverSendControl";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { SectionCard } from "@/components/ui/card";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { markWaiverInPersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";

function statusToneClass(
  state: DiverProfile["waiver"]["state"],
  requestStatus: DiverProfile["waiverRequest"],
) {
  if (requestStatus === "failed" || state === "medical_review") {
    return "border-danger/40 bg-danger/5";
  }
  if (state === "current") return "border-success/40 bg-success/5";
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
  if (diver.waiverRequest === "failed") {
    return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverFailed") };
  }
  if (diver.waiver.state === "expired") {
    return {
      label: t("divers.stats.waiverNotSigned"),
      detail: t("divers.stats.waiverLastSigned", { date: date(diver.waiver.signedAt) }),
    };
  }
  if (diver.waiverRequest === "not_signed") {
    return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverSent") };
  }
  return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverNotSent") };
}

/** One waiver card for status, delivery actions, private-link copying, and paper signatures. */
export function PaperWaiver({
  diver,
  shopSlug,
  personId,
  locale,
  status,
  timezone,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  timezone: string;
  /** This form's own outcome, rendered inside the card rather than page-top. */
  status?: DiverNotice;
}) {
  const t = staffTranslator(locale);
  const state = waiverStatusCopy(diver, t, locale, timezone);
  const needsAction = diver.waiver.state === "none" || diver.waiver.state === "expired";

  // Get the waiver send copy for the control
  const copy = waiverSendCopy(t);

  // Determine the button label based on waiver state
  const buttonLabel =
    diver.waiver.state === "expired"
      ? t("divers.stats.waiverResend")
      : t("divers.stats.waiverSend");

  return (
    <SectionCard
      className={`mt-8 ${statusToneClass(diver.waiver.state, diver.waiverRequest)}`}
      title={t("divers.stats.waiver")}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-lg font-semibold">{state.label}</p>
          {state.detail ? <p className="text-sm text-muted">{state.detail}</p> : null}
        </div>
        {needsAction ? (
          <div className="flex flex-col gap-3 sm:items-start">
            <WaiverSendControl
              shopSlug={shopSlug}
              surface="diver"
              personId={personId}
              bookingIds={[]}
              label={buttonLabel}
              exposeLink={true}
              copy={copy}
              wrapperClassName=""
              className="inline-flex"
            />
            <PaperWaiverControl
              action={markWaiverInPersonAction.bind(null, shopSlug, personId)}
              t={t}
              className=""
            />
          </div>
        ) : null}
      </div>
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
    </SectionCard>
  );
}
