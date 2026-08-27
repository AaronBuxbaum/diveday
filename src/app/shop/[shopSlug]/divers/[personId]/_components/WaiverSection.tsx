import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { SectionCard } from "@/components/ui/card";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { smsRecipient } from "@/lib/notifications/sms";
import { markWaiverInPersonAction } from "../actions";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";
import { WaiverDeliveryActions } from "./WaiverDeliveryActions";

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
  // A copied link and a delivered one are different facts, and the card said
  // "Link sent" about both. Nothing left DiveDay when a staffer took the URL —
  // where it went next is a conversation we never saw.
  if (diver.waiverRequest === "link_copied") {
    return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverLinkCopied") };
  }
  if (diver.waiverRequest === "not_signed") {
    return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverSent") };
  }
  return { label: t("divers.stats.waiverNotSigned"), detail: t("divers.stats.waiverNotSent") };
}

/**
 * The waiver card on a diver's record: what they have signed, and — when there
 * is something outstanding — every way to get it signed, as one row of peers.
 *
 * Four routes, not one send button with the rest disclosed underneath. A
 * staffer with an unsigned release in front of them is choosing between the
 * diver's inbox, the diver's phone, a link they will paste into a conversation
 * of their own, and the sheet of paper already in the diver's hand — and which
 * of those is right is a fact about the person standing there, not a fallback
 * order DiveDay can rank for them. Email and text appear only when the record
 * carries what they need; the link and the paper attestation always do.
 *
 * Nothing renders below the status for a diver who is already covered: a
 * current signature has nothing to send (`issueWaiverRequest` refuses it as
 * `already_completed`), and a medical hold is resolved in review, not by mailing
 * another link.
 */
export function WaiverSection({
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

  return (
    <SectionCard
      // `mt-3`, matching `StatsSummary`'s own `gap-3`: this card reads as the
      // fourth tile of the row above it, and `mt-8` set it nearly three times
      // further from those tiles than they sit from each other — a gap that
      // said "new section" about the one card that is a continuation of it.
      className={`mt-3 ${statusToneClass(diver.waiver.state, diver.waiverRequest)}`}
      title={t("divers.stats.waiver")}
    >
      <p className="text-lg font-semibold">{state.label}</p>
      {state.detail ? <p className="mt-0.5 text-sm text-muted">{state.detail}</p> : null}
      {needsAction ? (
        <WaiverDeliveryActions
          shopSlug={shopSlug}
          personId={personId}
          hasEmail={Boolean(diver.person.email)}
          // The same rule the send itself applies: a number with no unambiguous
          // country code cannot be texted, so offering the button would only
          // ever produce "no number we can text".
          hasPhone={Boolean(smsRecipient(diver.person.phone))}
          channelStates={diver.waiverChannels}
          copy={{
            email: t("divers.stats.sendWaiverViaEmail"),
            text: t("divers.stats.sendWaiverViaSms"),
            link: t("divers.stats.copyWaiverLink"),
            stateSent: t("divers.stats.waiverChannelSent"),
            stateCopied: t("divers.stats.waiverChannelCopied"),
            stateFailed: t("divers.stats.waiverChannelFailed"),
            stateUnavailable: t("divers.stats.waiverChannelUnavailable"),
          }}
          sendCopy={waiverSendCopy(t)}
        >
          <PaperWaiverControl
            action={markWaiverInPersonAction.bind(null, shopSlug, personId)}
            copy={paperWaiverCopy(t)}
            variant="secondary"
            className=""
            // A refused attestation lands back here with its notice; re-open
            // the form so the staffer can tick the box rather than hunt for the
            // trigger again. Any non-success notice on this card is one of the
            // two refusals `markWaiverInPersonAction` can produce — the missing
            // attestation is `warning`, not `danger`, because it is a step the
            // staffer skipped rather than something that broke.
            defaultOpen={Boolean(status) && status?.tone !== "success"}
          />
        </WaiverDeliveryActions>
      ) : null}
      <DiverFormStatus status={status} shopSlug={shopSlug} locale={locale} className="mt-3" />
    </SectionCard>
  );
}
