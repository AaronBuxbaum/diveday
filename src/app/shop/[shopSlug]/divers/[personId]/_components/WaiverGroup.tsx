import { waiverSendCopy } from "@/app/actions/waiver-send-types";
import { MedicalClearanceControl } from "@/components/MedicalClearanceControl";
import { medicalClearanceCopy } from "@/components/medical-clearance-copy";
import { PaperWaiverControl } from "@/components/PaperWaiverControl";
import { paperWaiverCopy } from "@/components/paper-waiver-copy";
import { WaiverStateRow } from "@/components/person/rows";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { InsetGroup } from "@/components/ui/ledger";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { type WaiverRowState, waiverRowStateText } from "@/i18n/waiver-labels";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { smsRecipient } from "@/lib/notifications/sms";
import { markWaiverInPersonAction, recordMedicalClearanceAction } from "../actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import type { DiverProfile } from "./shared";
import { WaiverDeliveryActions } from "./WaiverDeliveryActions";

/**
 * **Where the release stands, as one row** (ADR 20260827-people-not-lists,
 * decision 1: "Waiver (state + the four send routes as one row's actions)").
 *
 * The card this replaces was a tone-tinted panel with a status word in
 * `text-lg`, a detail line, and four delivery buttons laid out as a control
 * group — a whole section for a single fact about the person. It is now the
 * shared `WaiverStateRow` (8a) inside the file's inset group, with the tone in
 * the ink rather than in a fill, and the four routes behind one disclosure.
 *
 * **The routes stay four peers, disclosed together.** A staffer with an
 * unsigned release in front of them is choosing between the diver's inbox,
 * their phone, a link to paste into a conversation of their own, and the sheet
 * of paper already in the diver's hand — and which is right is a fact about the
 * person standing there, not a fallback order DiveDay can rank. Nothing is
 * offered at all for a diver already covered: a current signature has nothing
 * to send (`issueWaiverRequest` refuses it), and a medical hold is resolved in
 * review, not by mailing another link.
 */

/** The anchor the status ledger's "Send the waiver" lands on — a focusable `<summary>`. */
const SEND_ANCHOR = "waiver-send";

/**
 * The row's small print, by standing. `WaiverStateRow` states the standing
 * itself; this is the date or the reason behind it, and every branch is the
 * sentence the shipped card already used.
 */
function waiverDetail(
  diver: DiverProfile,
  t: StaffTranslator,
  locale: string,
  timezone: string,
): string {
  const date = (value: Date) => formatCalendarDate(calendarDateInTimezone(value, timezone), locale);
  if (diver.waiver.state === "current") {
    return t("divers.stats.waiverGoodUntil", { date: date(diver.waiver.expiresAt) });
  }
  if (diver.waiver.state === "medical_review") {
    return t("divers.stats.waiverHeldSince", { date: date(diver.waiver.at) });
  }
  if (diver.waiverRequest === "failed") return t("divers.stats.waiverFailed");
  if (diver.waiver.state === "expired") {
    return t("divers.stats.waiverLastSigned", { date: date(diver.waiver.signedAt) });
  }
  // A copied link and a delivered one are different facts, and the card said
  // "Link sent" about both. Nothing left DiveDay when a staffer took the URL.
  if (diver.waiverRequest === "link_copied") return t("divers.stats.waiverLinkCopied");
  if (diver.waiverRequest === "not_signed") return t("divers.stats.waiverSent");
  return t("divers.stats.waiverNotSent");
}

export function WaiverGroup({
  diver,
  shopSlug,
  personId,
  locale,
  t,
  timezone,
  status,
}: {
  diver: DiverProfile;
  shopSlug: string;
  personId: string;
  locale: string;
  t: StaffTranslator;
  timezone: string;
  /** This group's own outcome, rendered in the group rather than page-top. */
  status?: DiverNotice;
}) {
  // A delivery failure is a fact about the message we sent, not about the
  // standing — the diver has still simply not signed. `waiver-labels.ts`
  // carries the asymmetry; this is the one place the record composes it.
  const state: WaiverRowState =
    diver.waiverRequest === "failed" && diver.waiver.state !== "current"
      ? "failed"
      : diver.waiver.state;
  const needsAction = diver.waiver.state === "none" || diver.waiver.state === "expired";
  // A hold has exactly one way out, and it is not another link: the diver comes
  // back with a physician's evaluation and a staffer records it (issue #1252).
  // Before this the group offered nothing at all here, because the only lift in
  // the app asserted the opposite of what had happened.
  const heldForMedical = diver.waiver.state === "medical_review";
  return (
    <DiverFileGroupDisclosure
      id="waiver"
      label={t("divers.stats.waiver")}
      summary={waiverRowStateText(t, state)}
      open={Boolean(status)}
      className="mt-8"
    >
      <InsetGroup
        as="h2"
        id="waiver"
        label={t("divers.stats.waiver")}
        labelClassName="max-sm:hidden"
        className="scroll-mt-24"
      >
        <WaiverStateRow
          as="div"
          t={t}
          state={state}
          detail={waiverDetail(diver, t, locale, timezone)}
        />
        {/* The four routes are the state row's actions, laid out as their own
            row beneath it rather than in the row's right-hand column. The
            column is the width of its buttons, and the panel that drops out of
            it carries a medical attestation a staffer puts their name to —
            `DiverHeader` made the same call about the details editor, and for
            the same reason: a disclosure whose panel is wider than its trigger
            belongs on a line of its own. */}
        {needsAction ? (
          <details
            className="group px-5 py-3 sm:px-6"
            // A refusal aimed at this group re-opens it. The notice renders
            // below, outside the disclosure, so the staffer is told *that*
            // something was refused — but the box they must correct is shut,
            // and the `defaultOpen` on the attestation below cannot help while
            // its own parent is closed. A success needs no form back.
            open={Boolean(status) && status?.tone !== "success"}
          >
            <summary
              id={SEND_ANCHOR}
              className={buttonClass({
                variant: "secondary",
                size: "sm",
                className: "w-fit cursor-pointer list-none [&::-webkit-details-marker]:hidden",
              })}
            >
              {t("divers.waiver.sendOptions")}
              <DisclosureCaret direction="down" className="group-open:rotate-180" />
            </summary>
            <div className="mt-3">
              <WaiverDeliveryActions
                shopSlug={shopSlug}
                personId={personId}
                hasEmail={Boolean(diver.person.email)}
                // The same rule the send itself applies: a number with no
                // unambiguous country code cannot be texted, so offering the
                // button would only ever produce "no number we can text".
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
                  // A refused attestation lands back here with its notice;
                  // re-open the form so the staffer can tick the box rather
                  // than hunt for the trigger again.
                  defaultOpen={Boolean(status) && status?.tone !== "success"}
                />
              </WaiverDeliveryActions>
            </div>
          </details>
        ) : null}
        {heldForMedical ? (
          <div className="px-5 py-3 sm:px-6">
            <MedicalClearanceControl
              action={recordMedicalClearanceAction.bind(null, shopSlug, personId)}
              copy={medicalClearanceCopy(t)}
              // The shop's own today, so the date box cannot offer tomorrow: a
              // Key Largo evening is already tomorrow in UTC, and the reader's
              // browser zone is nobody's business here.
              today={calendarDateInTimezone(nowDate(), timezone)}
              className=""
              defaultOpen={Boolean(status) && status?.tone !== "success"}
            />
          </div>
        ) : null}
        {status ? (
          <div className="px-5 py-3 sm:px-6">
            <DiverFormStatus status={status} />
          </div>
        ) : null}
      </InsetGroup>
    </DiverFileGroupDisclosure>
  );
}
