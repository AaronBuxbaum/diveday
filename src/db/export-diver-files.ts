import type { DiverExportContext } from "./export";
import {
  BOOKING_ARRIVAL_EVENTS_CSV,
  BOOKING_CHECKOUT_BOOKINGS_CSV,
  BOOKING_PAYMENT_EVENTS_CSV,
  BOOKINGS_CSV,
  BUDDY_PAIRS_CSV,
  CERTIFICATIONS_CSV,
  COURSE_FORM_RECORDS_CSV,
  COURSE_INQUIRIES_CSV,
  CUSTOMER_GEAR_ITEMS_CSV,
  DIVE_PACKAGE_ENTITLEMENTS_CSV,
  diverFile,
  GEAR_RESERVATIONS_CSV,
  IMPORTED_PAYMENT_HISTORY_CSV,
  LAST_MINUTE_LIST_CSV,
  NITROX_CERTIFICATIONS_CSV,
  NOTIFICATION_DELIVERIES_CSV,
  ORDER_LINE_ITEMS_CSV,
  ORDERS_CSV,
  PRIOR_VISITS_CSV,
  RECAP_PHOTOS_CSV,
  RENTAL_FIT_CSV,
  REVIEW_MODERATION_EVENTS_CSV,
  ROLL_CALL_EVENTS_CSV,
  SPECIALTY_CERTIFICATIONS_CSV,
  TIPS_CSV,
  TRIP_INVITATIONS_CSV,
  TRIP_LAST_MINUTE_PROMO_RECIPIENTS_CSV,
  TRIP_REVIEWS_CSV,
  WAITLIST_ENTRIES_CSV,
  WAIVER_RECORDS_CSV,
  WORK_ORDER_CARE_CSV,
  WORK_ORDER_LINES_CSV,
  WORK_ORDERS_CSV,
} from "./export-shared-files";
import type { ExportFileSpec } from "./export-tables";

/**
 * **One diver's own bundle, file by file** (ADR 20260824-diver-record-export):
 * every CSV `loadDiverExportBundleInput` writes, in bundle order. The same
 * tables as the shop bundle, read by the diver's person id or their bookings,
 * but **not the same files**: each one is shaped for a subject-access answer —
 * other people appear by name where the diver needs to know who, and not at
 * all where the row is shared (the decisions are written above
 * `loadDiverExportBundleInput` in `./export`).
 *
 * A table both bundles write is declared once, in `./export-shared-files`,
 * where every column names the bundle it belongs to; `diverFile` takes the
 * columns marked for the diver. The two entries written out here are the ones
 * with no shop twin: the diver's own profile, and the release wording *as
 * signed*, which is a snapshot on the diver's records rather than the shop's
 * live template.
 */

export const DIVER_EXPORT_FILES: ExportFileSpec<DiverExportContext>[] = [
  {
    file: "profile.csv",
    header: [
      "id",
      "full_name",
      "email",
      "phone",
      "date_of_birth",
      "dive_insurance",
      "emergency_contact_name",
      "emergency_contact_phone",
      "courtesy_email_opt_out_at",
      "no_certification_declared_at",
      "no_certification_cleared_at",
      "adult_attested_at",
      "deleted_at",
      "created_at",
    ],
    rows: ({ person }) => [
      [
        person.id,
        person.fullName,
        person.email,
        person.phone,
        person.dateOfBirth,
        person.diveInsurance,
        person.emergencyContactName,
        person.emergencyContactPhone,
        person.courtesyEmailOptOutAt,
        person.noCertificationDeclaredAt,
        person.noCertificationClearedAt,
        person.adultAttestedAt,
        person.deletedAt,
        person.createdAt,
      ],
    ],
    note: "This diver's own contact and profile record.",
  },
  diverFile(CERTIFICATIONS_CSV),
  diverFile(SPECIALTY_CERTIFICATIONS_CSV),
  diverFile(NITROX_CERTIFICATIONS_CSV),
  diverFile(BOOKINGS_CSV),
  diverFile(WAITLIST_ENTRIES_CSV),
  diverFile(TRIP_INVITATIONS_CSV),
  diverFile(LAST_MINUTE_LIST_CSV),
  diverFile(TRIP_LAST_MINUTE_PROMO_RECIPIENTS_CSV),
  diverFile(BOOKING_PAYMENT_EVENTS_CSV),
  diverFile(BOOKING_CHECKOUT_BOOKINGS_CSV),
  diverFile(BOOKING_ARRIVAL_EVENTS_CSV),
  diverFile(ROLL_CALL_EVENTS_CSV),
  diverFile(BUDDY_PAIRS_CSV),
  {
    file: "waiver_templates.csv",
    header: ["id", "title", "version", "body"],
    // waiverRecords.templateBody is the text as signed — a snapshot at
    // signing time, never the live waiverTemplates row, which a shop can
    // go on editing after this diver signed. One row per distinct
    // template this diver actually agreed to.
    rows: ({ waiverRows }) =>
      (() => {
        const templateIds = [...new Set(waiverRows.map((row) => row.templateId))];
        return templateIds.map((id) => {
          const row = waiverRows.find((waiver) => waiver.templateId === id);
          return [id, row?.templateTitle, row?.templateVersion, row?.templateBody];
        });
      })(),
    note: "The exact wording of each release this diver signed, by version, as it read the moment they signed it.",
  },
  diverFile(WAIVER_RECORDS_CSV),
  diverFile(COURSE_FORM_RECORDS_CSV),
  diverFile(RENTAL_FIT_CSV),
  diverFile(GEAR_RESERVATIONS_CSV),
  diverFile(CUSTOMER_GEAR_ITEMS_CSV),
  diverFile(WORK_ORDERS_CSV),
  diverFile(WORK_ORDER_LINES_CSV),
  diverFile(WORK_ORDER_CARE_CSV),
  diverFile(PRIOR_VISITS_CSV),
  diverFile(IMPORTED_PAYMENT_HISTORY_CSV),
  diverFile(NOTIFICATION_DELIVERIES_CSV),
  diverFile(ORDERS_CSV),
  diverFile(ORDER_LINE_ITEMS_CSV),
  diverFile(TIPS_CSV),
  diverFile(RECAP_PHOTOS_CSV),
  diverFile(TRIP_REVIEWS_CSV),
  diverFile(REVIEW_MODERATION_EVENTS_CSV),
  diverFile(DIVE_PACKAGE_ENTITLEMENTS_CSV),
  diverFile(COURSE_INQUIRIES_CSV),
];
