import {
  bookingConfirmationEmail,
  checkoutRecoveryEmail,
  courseInquiryEmail,
  demoStartedAlertEmail,
  lastMinuteDealEmail,
  type NotificationEmail,
  newAccountAlertEmail,
  passwordChangedEmail,
  passwordResetEmail,
  staffInviteEmail,
  tripBlowoutEmail,
  tripConditionsHoldEmail,
  tripMinimumNotMetEmail,
  tripRecapEmail,
  tripReminderEmail,
  usageCeilingAlertEmail,
  verifyAccountEmail,
  waitlistInviteEmail,
  waiverRequestEmail,
  welcomeEmail,
  wrapEmailHtml,
} from "./email";
import type { Notification } from "./kinds";

/**
 * Which email body each notification kind renders to, and the document chrome
 * wrapped around all of them.
 *
 * One dispatch table rather than a branch per provider: a second channel that
 * sends email renders the same bytes, and the exhaustiveness of the chain below
 * is what makes a new kind a compile error rather than a silent blank message.
 */

export function messageFor(notification: Notification): NotificationEmail {
  const message = rawMessageFor(notification);
  // Not every kind carries both fields (the internal new-account alert has no
  // locale; password-changed has no shop to brand as) — the wrapper's own
  // document chrome (doctype, viewport, container) applies uniformly either way.
  const shopName = "shopName" in notification ? notification.shopName : "DiveDay";
  const locale = "locale" in notification ? notification.locale : "en";
  return { ...message, html: wrapEmailHtml(message.html, { shopName, locale }) };
}

function rawMessageFor(notification: Notification): NotificationEmail {
  if (notification.kind === "booking_confirmation") return bookingConfirmationEmail(notification);
  if (notification.kind === "waitlist_invite") return waitlistInviteEmail(notification);
  if (notification.kind === "trip_reminder_7d") {
    return tripReminderEmail({ ...notification, lead: "week" });
  }
  if (notification.kind === "trip_reminder_24h") {
    return tripReminderEmail({ ...notification, lead: "day" });
  }
  if (notification.kind === "trip_recap") return tripRecapEmail(notification);
  if (notification.kind === "trip_conditions_hold") return tripConditionsHoldEmail(notification);
  if (notification.kind === "trip_blowout") return tripBlowoutEmail(notification);
  if (notification.kind === "trip_minimum_not_met") return tripMinimumNotMetEmail(notification);
  if (notification.kind === "waiver_request") return waiverRequestEmail(notification);
  if (notification.kind === "welcome") return welcomeEmail(notification);
  if (notification.kind === "email_verification") return verifyAccountEmail(notification);
  if (notification.kind === "password_reset_request") return passwordResetEmail(notification);
  if (notification.kind === "staff_invite") return staffInviteEmail(notification);
  if (notification.kind === "checkout_recovery") return checkoutRecoveryEmail(notification);
  if (notification.kind === "last_minute_deal") return lastMinuteDealEmail(notification);
  if (notification.kind === "new_account_alert") return newAccountAlertEmail(notification);
  if (notification.kind === "demo_started_alert") return demoStartedAlertEmail(notification);
  if (notification.kind === "usage_ceiling_alert") return usageCeilingAlertEmail(notification);
  if (notification.kind === "course_inquiry") return courseInquiryEmail(notification);
  return passwordChangedEmail(notification);
}
