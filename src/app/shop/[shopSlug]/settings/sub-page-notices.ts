import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeMessages } from "@/lib/staff-notices";
import type { BillingNotice } from "./billing/actions";

/**
 * What each settings sub-page says back after a write.
 *
 * The hub's own `noticeMessages()` in `SettingsPage.tsx` holds every code the
 * directory can answer with — seventy of them — and a sub-page that imported it
 * would drag a 3,000-line module into its graph to read four strings. So each
 * page that moved out of the hub takes the four or five codes its own actions
 * emit, and nothing else.
 *
 * The maps stay *here* rather than in each page for the reason `team/notices.ts`
 * does: the action and the page have to agree on the spelling of a code, and one
 * file they both read is where that agreement is checkable.
 *
 * Each is built inside the request, not at module scope, so the text tracks the
 * negotiated locale rather than freezing to whichever locale first imported this
 * file.
 */
/** `/settings/rentals` — `saveRentalsAction`. */
export function rentalsNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "rentals-saved": { tone: "success", text: t("settings.main.notice.rentalsSaved") },
    "rental-prices-invalid": {
      tone: "danger",
      text: t("settings.main.notice.rentalPricesInvalid"),
    },
    "rental-terms-invalid": { tone: "danger", text: t("settings.main.notice.rentalTermsInvalid") },
    "regulator-service-invalid": {
      tone: "danger",
      text: t("settings.main.notice.regulatorServiceInvalid"),
    },
    "nitrox-fill-invalid": { tone: "danger", text: t("settings.main.notice.nitroxFillInvalid") },
  };
}

/** `/settings/emergency-reference` — `saveEmergencyReferenceAction`. */
export function emergencyReferenceNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "emergency-saved": { tone: "success", text: t("settings.main.notice.emergencySaved") },
    "shore-alert-invalid": { tone: "danger", text: t("settings.main.notice.shoreAlertInvalid") },
    "shore-alert-consent-missing": {
      tone: "danger",
      text: t("settings.main.notice.shoreAlertConsentMissing"),
    },
    "shore-alert-confirmation-sent": {
      tone: "success",
      text: t("settings.main.notice.shoreAlertConfirmationSent"),
    },
    "shore-alert-confirmation-not-sent": {
      tone: "warning",
      text: t("settings.main.notice.shoreAlertConfirmationNotSent"),
    },
    "shore-alert-saved-demo": {
      tone: "success",
      text: t("settings.main.notice.shoreAlertSavedDemo"),
    },
    "shore-alert-cleared": { tone: "success", text: t("settings.main.notice.shoreAlertCleared") },
  };
}

/** `/settings/dock-day` — `saveDockDayAction`: one success, and each section's own refusal. */
export function dockDayNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "dock-day-saved": { tone: "success", text: t("settings.dockDay.saved") },
    "dock-invalid": { tone: "danger", text: t("settings.main.notice.dockInvalid") },
    "turnaround-invalid": { tone: "danger", text: t("settings.main.notice.turnaroundInvalid") },
    "crew-lead-invalid": { tone: "danger", text: t("settings.main.notice.crewLeadInvalid") },
    "desk-payment-invalid": { tone: "danger", text: t("settings.main.notice.deskPaymentInvalid") },
  };
}

/** `/settings/profile` — `saveProfileAction`. */
export function profileNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "profile-saved": { tone: "success", text: t("settings.main.notice.profileSaved") },
    "profile-invalid": { tone: "danger", text: t("settings.main.notice.profileInvalid") },
  };
}

/** Promos' packages section — `createDivePackageAction`, `deleteDivePackageAction`. */
export function divePackageNoticeMessages(t: StaffTranslator): NoticeMessages {
  return {
    "package-saved": { tone: "success", text: t("settings.main.notice.packageSaved") },
    "package-deleted": { tone: "success", text: t("settings.main.notice.packageDeleted") },
    "package-invalid": { tone: "danger", text: t("settings.main.notice.packageInvalid") },
  };
}

/**
 * `/settings/billing` — `startBillingCheckoutAction`, `openBillingPortalAction`,
 * and Checkout's own success redirect. Typed against the actions' `BillingNotice`
 * so a code added there without words here is a compile error.
 */
export function billingNoticeMessages(t: StaffTranslator): NoticeMessages<BillingNotice> {
  return {
    "card-added": { tone: "success", text: t("billing.notice.cardAdded") },
    "not-configured": { tone: "danger", text: t("billing.notice.notConfigured") },
    unavailable: { tone: "danger", text: t("billing.notice.unavailable") },
    demo: { tone: "danger", text: t("billing.notice.demo") },
    pending: { tone: "neutral", text: t("billing.notice.pending") },
  };
}
