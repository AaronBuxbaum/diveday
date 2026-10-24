import { diverTranslator } from "@/i18n/messages";
import { isDiverLocale } from "@/i18n/settings";
import { escapeHtml } from "@/lib/html";
import {
  bookkeeperConfirmationEmail,
  bookkeeperMonthEndEmail,
  bookkeeperNoticeEmail,
} from "./bookkeeper-email";
import { courseCertifiedEmail } from "./course-certified";
import { crewScheduleChangeEmail } from "./crew-emails";
import {
  deskAfterHoursEmail,
  moveAskSoonEmail,
  stripePaymentsRestrictedEmail,
} from "./desk-emails";
import { departureNoteEmail, lostItemEmail } from "./desk-notes";
import { diverStateEmail } from "./diver-state-email";
import {
  bookingCancelledEmail,
  bookingConfirmationEmail,
  bookingHandoffEmail,
  checkoutRecoveryEmail,
  contactEmailConfirmationEmail,
  demoStartedAlertEmail,
  type EmailShopBrand,
  founderDigestEmail,
  guardianReleaseCopyEmail,
  interestReceivedEmail,
  lastMinuteDealEmail,
  type NotificationEmail,
  newAccountAlertEmail,
  passwordChangedEmail,
  passwordResetEmail,
  readinessLinkEmail,
  setupRequestAlertEmail,
  staffInviteEmail,
  staffReplyEmail,
  tripBlowoutEmail,
  tripConditionsHoldEmail,
  tripInvitationEmail,
  tripMinimumNotMetEmail,
  tripRescheduledEmail,
  usageCeilingAlertEmail,
  verifyAccountEmail,
  waitlistInviteEmail,
  waiverRequestEmail,
  welcomeEmail,
  wrapEmailHtml,
} from "./email";
import { incidentMissingDiverEmail, incidentMissingDiverFoundEmail } from "./incident-emails";
import { interestReceivedAckEmail } from "./interest-received-ack";
import type { Notification } from "./kinds";
import { partyPaymentReceiptEmail } from "./party-payment-receipt";
import {
  rollCallStaleEmail,
  rollCallStaleShoreEmail,
  shoreAlertConfirmationEmail,
  shoreAlertStoppedEmail,
} from "./roll-call-emails";
import { seatAlreadyHeldEmail } from "./seat-already-held";
import { setupRequestReceiptEmail } from "./setup-request-receipt";
import { shopVoiceOf } from "./shop-voice";
import { weeklyDigestEmail } from "./weekly-digest-email";
import { gearServiceDueEmail, workOrderReadyEmail } from "./work-order-emails";

/**
 * Which email body each notification kind renders to, and the document chrome
 * wrapped around all of them.
 *
 * One dispatch table rather than a branch per provider: a second channel that
 * sends email renders the same bytes, and the exhaustiveness of the chain below
 * is what makes a new kind a compile error rather than a silent blank message.
 */

export function messageFor(notification: Notification): NotificationEmail {
  const message = withPostalFooter(rawMessageFor(notification), notification);
  // Not every kind carries both fields (the internal new-account alert has no
  // locale; password-changed has no shop to brand as) — the wrapper's own
  // document chrome (doctype, viewport, container) applies uniformly either way.
  const shopName = "shopName" in notification ? notification.shopName : "DiveDay";
  const locale = "locale" in notification ? notification.locale : "en";
  // Sent as the shop: its logo, its colour, DiveDay as the credit at the foot
  // (`shopVoiceOf`, the same decision the `From` name reads).
  const brand: EmailShopBrand | undefined = shopVoiceOf(notification)
    ? {
        logoUrl: notification.sender?.logoUrl,
        color: notification.sender?.brandColor,
        credit: diverTranslator(isDiverLocale(locale) ? locale : "en-US")("shopChrome.credit"),
      }
    : undefined;
  return { ...message, html: wrapEmailHtml(message.html, { shopName, locale, brand }) };
}

/**
 * The sender's postal address under every commercial message — the kinds
 * that carry an `unsubscribeUrl` are exactly the ones CAN-SPAM (16 CFR
 * 316.2) calls commercial, and the same statute wants the sender's physical
 * address in them (ADR 20260902-sender-standards-for-ses). The shop is that
 * sender: the mail greets as the shop and sells the shop's seats. A
 * transactional message (a confirmation, a waiver link) is left alone, and so
 * is a shop with no street on file — `sender.postalAddress` is absent then,
 * never a blank line.
 *
 * Name and address only, no sentence: the two are the shop's own words
 * passed through, so there is no copy here for a bundle to carry.
 */
function withPostalFooter(
  message: NotificationEmail,
  notification: Notification,
): NotificationEmail {
  const postalAddress = notification.sender?.postalAddress;
  if (!postalAddress || !("unsubscribeUrl" in notification) || !("shopName" in notification)) {
    return message;
  }
  const line = `${notification.shopName} · ${postalAddress}`;
  return {
    ...message,
    text: `${message.text.replace(/\n*$/, "")}\n\n${line}\n`,
    html: `${message.html}<p style="margin-top: 24px; font-size: 12px; line-height: 1.5; opacity: 0.7;">${escapeHtml(line)}</p>`,
  };
}

/** One kind, five events: the event picks the words, never the reader. */
function operatorAlertEmail(
  notification: Extract<Notification, { kind: "operator_alert" }>,
): NotificationEmail {
  switch (notification.event) {
    case "new_account":
      return newAccountAlertEmail(notification);
    case "demo_started":
      return demoStartedAlertEmail(notification);
    case "usage_ceiling":
      return usageCeilingAlertEmail(notification);
    case "setup_request":
      return setupRequestAlertEmail(notification);
    case "founder_digest":
      return founderDigestEmail(notification);
  }
}

/** One kind, three readers: the purpose picks whose address is being vouched for. */
function addressConfirmationEmail(
  notification: Extract<Notification, { kind: "address_confirmation" }>,
): NotificationEmail {
  switch (notification.purpose) {
    case "account":
      return verifyAccountEmail({ ...notification, verifyUrl: notification.confirmUrl });
    case "shop_contact":
      return contactEmailConfirmationEmail(notification);
    case "shore_alert":
      return shoreAlertConfirmationEmail(notification);
  }
}

function rawMessageFor(notification: Notification): NotificationEmail {
  if (notification.kind === "setup_request_receipt") return setupRequestReceiptEmail(notification);
  if (notification.kind === "booking_confirmation") return bookingConfirmationEmail(notification);
  // Service mail: a diver who joined the wait list hears "a seat opened"; the
  // reply to a date request is the invitation. Neither carries a way out.
  if (notification.kind === "seat_offer") {
    return notification.answers === "wait_list"
      ? waitlistInviteEmail(notification)
      : tripInvitationEmail(notification);
  }
  // A waiting diver hears "a seat opened"; anyone the shop reached out to hears
  // that the shop is offering it. The words are the diver's, unchanged.
  if (notification.kind === "seat_offer_commercial") {
    // An offer that carries a deal says the deal: the code, the figure and the
    // day the code stops working.
    if (notification.code !== undefined && notification.expiresAt !== undefined) {
      return lastMinuteDealEmail({
        ...notification,
        code: notification.code,
        expiresAt: notification.expiresAt,
      });
    }
    return notification.askedBy === "diver"
      ? waitlistInviteEmail(notification)
      : tripInvitationEmail(notification);
  }
  if (notification.kind === "trip_reminder_7d") {
    return diverStateEmail({ ...notification, state: "week_out" });
  }
  if (notification.kind === "trip_reminder_24h") {
    return diverStateEmail({ ...notification, state: "tonight" });
  }
  if (notification.kind === "fly_safe_correction") {
    return diverStateEmail({ ...notification, state: "fly_safe_correction" });
  }
  if (notification.kind === "trip_rescheduled") return tripRescheduledEmail(notification);
  if (notification.kind === "trip_recap")
    return diverStateEmail({ ...notification, state: "home" });
  if (notification.kind === "trip_conditions_hold") return tripConditionsHoldEmail(notification);
  if (notification.kind === "trip_blowout") return tripBlowoutEmail(notification);
  if (notification.kind === "trip_minimum_not_met") return tripMinimumNotMetEmail(notification);
  if (notification.kind === "booking_cancelled") return bookingCancelledEmail(notification);
  if (notification.kind === "waiver_request") return waiverRequestEmail(notification);
  if (notification.kind === "guardian_release_copy") return guardianReleaseCopyEmail(notification);
  if (notification.kind === "readiness_link") return readinessLinkEmail(notification);
  if (notification.kind === "booking_handoff") return bookingHandoffEmail(notification);
  if (notification.kind === "welcome") return welcomeEmail(notification);
  if (notification.kind === "address_confirmation") return addressConfirmationEmail(notification);
  if (notification.kind === "password_reset_request") return passwordResetEmail(notification);
  if (notification.kind === "staff_invite") return staffInviteEmail(notification);
  if (notification.kind === "checkout_recovery") return checkoutRecoveryEmail(notification);
  if (notification.kind === "operator_alert") return operatorAlertEmail(notification);
  if (notification.kind === "interest_received") return interestReceivedEmail(notification);
  if (notification.kind === "staff_reply") return staffReplyEmail(notification);
  if (notification.kind === "weekly_digest") return weeklyDigestEmail(notification);
  if (notification.kind === "work_order_ready") return workOrderReadyEmail(notification);
  if (notification.kind === "gear_service_due") return gearServiceDueEmail(notification);
  if (notification.kind === "crew_schedule_change") return crewScheduleChangeEmail(notification);
  if (notification.kind === "desk_after_hours") return deskAfterHoursEmail(notification);
  if (notification.kind === "stripe_payments_restricted") {
    return stripePaymentsRestrictedEmail(notification);
  }
  if (notification.kind === "move_ask_soon") return moveAskSoonEmail(notification);
  if (notification.kind === "roll_call_stale") return rollCallStaleEmail(notification);
  if (notification.kind === "roll_call_stale_shore") return rollCallStaleShoreEmail(notification);
  if (notification.kind === "incident_missing_diver")
    return incidentMissingDiverEmail(notification);
  if (notification.kind === "incident_missing_diver_found") {
    return incidentMissingDiverFoundEmail(notification);
  }
  if (notification.kind === "shore_alert_stopped") return shoreAlertStoppedEmail(notification);
  if (notification.kind === "departure_note") return departureNoteEmail(notification);
  if (notification.kind === "lost_item_found") return lostItemEmail(notification);
  if (notification.kind === "seat_already_held") return seatAlreadyHeldEmail(notification);
  if (notification.kind === "party_payment_receipt") return partyPaymentReceiptEmail(notification);
  if (notification.kind === "course_certified") return courseCertifiedEmail(notification);
  if (notification.kind === "bookkeeper_month_end") return bookkeeperMonthEndEmail(notification);
  if (notification.kind === "bookkeeper_confirmation") {
    return bookkeeperConfirmationEmail(notification);
  }
  if (notification.kind === "bookkeeper_notice") return bookkeeperNoticeEmail(notification);
  if (notification.kind === "interest_received_ack") {
    return interestReceivedAckEmail(notification);
  }
  return passwordChangedEmail(notification);
}
