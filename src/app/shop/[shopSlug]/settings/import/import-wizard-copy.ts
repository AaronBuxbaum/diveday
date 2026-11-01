import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ImportField, ImportIssueCode } from "@/lib/import";
import type { ImportActionErrorCode } from "./actions";

/**
 * Every word this wizard renders, resolved on the server and passed down as
 * plain data — see the note in `src/i18n/staff-messages.ts`. Several of these
 * are ICU-flavored templates (`{name}`, and `{count, plural, one {…} other
 * {…}}`) because the values they interpolate — a parsed CSV's row counts, an
 * import result's summary counts — are only known once this client component
 * runs; `fill()` below resolves them locally, the same syntax `staffTranslator`
 * resolves on the server.
 */
export type ImportWizardCopy = {
  heading: string;
  chooseFile: string;
  chooseDifferentFile: string;
  columnTitle: string;
  fieldLabels: Record<ImportField, string>;
  ignoredMedicalColumns: string;
  unmappedColumns: string;
  waiverRowsNoticeOne: string;
  waiverRowsNoticeOther: string;
  visitRowsNoticeOne: string;
  visitRowsNoticeOther: string;
  paymentHistoryRowsNoticeOne: string;
  paymentHistoryRowsNoticeOther: string;
  /** `{count}` and `{system}`: bookings dated after the shop's today, which are not seats here. */
  bookingsAfterTodayOne: string;
  bookingsAfterTodayOther: string;
  bookingsAfterTodayMore: string;
  /** The system the file came from, when the page knows it; otherwise "your old system". */
  sourceSystem: string;
  stats: {
    diversInFile: string;
    extraCardRows: string;
    skipped: string;
    cards: string;
    specialties: string;
    nitroxCards: string;
    waivers: string;
    pastVisits: string;
    paymentHistory: string;
    internalNotes: string;
  };
  table: {
    rowNumber: string;
    name: string;
    email: string;
    card: string;
    waiver: string;
    notes: string;
    noName: string;
    skippedBadge: string;
    mergedBadge: string;
    certImported: string;
    certForReview: string;
    certLine: string;
    specialtyLine: string;
    waiverAcceptedImported: string;
    emptyValue: string;
  };
  /** Phone-only: the preview's six columns scroll sideways, so say so. */
  previewSwipeHint: string;
  hiddenRowsNoticeOne: string;
  hiddenRowsNoticeOther: string;
  submitOne: string;
  submitOther: string;
  submitting: string;
  /** Every `ImportIssueCode` `src/lib/import.ts` can raise, resolved to its raw ICU
   * template — `fill()` interpolates each issue's `params` once the row is known
   * (only client-side, since the CSV preview never touches the server). */
  /**
   * One template per issue code, or a `{ one, other }` pair where the sentence
   * counts something. It cannot be a single ICU string: staff copy crosses to
   * the client unformatted (`t.raw`) and is resolved here by `fill()`, a plain
   * `{name}` replace that would print an ICU plural's source verbatim.
   */
  issues: Record<ImportIssueCode, string | { one: string; other: string }>;
  /**
   * Every `ImportActionErrorCode` — both the client-computed `prepared.fatal`
   * (before submit) and the server action's `state` (after submit) resolve
   * through this one map, since the action passes `prepared.fatal`'s own code
   * straight through unchanged.
   */
  errors: Record<ImportActionErrorCode, string>;
  result: {
    summary: string;
    summaryAddedOne: string;
    summaryAddedOther: string;
    summaryUpdatedOne: string;
    summaryUpdatedOther: string;
    cardsLineOne: string;
    cardsLineOther: string;
    cardsCertificationsOne: string;
    cardsCertificationsOther: string;
    cardsSpecialtyOne: string;
    cardsSpecialtyOther: string;
    cardsNitroxOne: string;
    cardsNitroxOther: string;
    rowsMergedNote: string;
    cardsSkippedNote: string;
    rowsSkippedNote: string;
    cardsHeldByAnother: string;
    specialtyGateNote: string;
    waiversLineOne: string;
    waiversLineOther: string;
    waiversSkippedExistingNote: string;
    waiversSkippedNoTemplateNoteOne: string;
    waiversSkippedNoTemplateNoteOther: string;
    waiverDocumentsFailedNote: string;
    visitsLineOne: string;
    visitsLineOther: string;
    visitsSkippedNote: string;
    paymentHistoryLineOne: string;
    paymentHistoryLineOther: string;
    paymentHistorySkippedNote: string;
    receiptDocumentsFailedNote: string;
    notesLineOne: string;
    notesLineOther: string;
    sizesDeclinedLineOne: string;
    sizesDeclinedLineOther: string;
    seeRoster: string;
  };
};

/**
 * Every word the client-side wizard renders, resolved on the server — a staff
 * Client Component takes copy as props, never a translator (see
 * `src/i18n/staff-messages.ts`).
 */
export function importWizardCopy(t: StaffTranslator, sourceSystem: string): ImportWizardCopy {
  const fieldLabels: Record<ImportField, string> = {
    first_name: t("settings.import.wizard.fieldLabels.first_name"),
    last_name: t("settings.import.wizard.fieldLabels.last_name"),
    full_name: t("settings.import.wizard.fieldLabels.full_name"),
    email: t("settings.import.wizard.fieldLabels.email"),
    phone: t("settings.import.wizard.fieldLabels.phone"),
    date_of_birth: t("settings.import.wizard.fieldLabels.date_of_birth"),
    emergency_contact_name: t("settings.import.wizard.fieldLabels.emergency_contact_name"),
    emergency_contact_phone: t("settings.import.wizard.fieldLabels.emergency_contact_phone"),
    dive_insurance: t("settings.import.wizard.fieldLabels.dive_insurance"),
    certification_agency: t("settings.import.wizard.fieldLabels.certification_agency"),
    certification_level: t("settings.import.wizard.fieldLabels.certification_level"),
    certification_number: t("settings.import.wizard.fieldLabels.certification_number"),
    certification_status: t("settings.import.wizard.fieldLabels.certification_status"),
    specialty: t("settings.import.wizard.fieldLabels.specialty"),
    specialty_certification_number: t(
      "settings.import.wizard.fieldLabels.specialty_certification_number",
    ),
    nitrox_certified: t("settings.import.wizard.fieldLabels.nitrox_certified"),
    nitrox_certification_number: t(
      "settings.import.wizard.fieldLabels.nitrox_certification_number",
    ),
    bcd_size: t("settings.import.wizard.fieldLabels.bcd_size"),
    wetsuit_size: t("settings.import.wizard.fieldLabels.wetsuit_size"),
    boot_size: t("settings.import.wizard.fieldLabels.boot_size"),
    fin_size: t("settings.import.wizard.fieldLabels.fin_size"),
    waiver_accepted: t("settings.import.wizard.fieldLabels.waiver_accepted"),
    waiver_signed_at: t("settings.import.wizard.fieldLabels.waiver_signed_at"),
    waiver_source_name: t("settings.import.wizard.fieldLabels.waiver_source_name"),
    waiver_document_url: t("settings.import.wizard.fieldLabels.waiver_document_url"),
    medical_document_url: t("settings.import.wizard.fieldLabels.medical_document_url"),
    payment_date: t("settings.import.wizard.fieldLabels.payment_date"),
    payment_status: t("settings.import.wizard.fieldLabels.payment_status"),
    payment_amount: t("settings.import.wizard.fieldLabels.payment_amount"),
    payment_currency: t("settings.import.wizard.fieldLabels.payment_currency"),
    payment_direction: t("settings.import.wizard.fieldLabels.payment_direction"),
    payment_reference: t("settings.import.wizard.fieldLabels.payment_reference"),
    receipt_reference: t("settings.import.wizard.fieldLabels.receipt_reference"),
    receipt_document_url: t("settings.import.wizard.fieldLabels.receipt_document_url"),
    stripe_reference: t("settings.import.wizard.fieldLabels.stripe_reference"),
    visit_date: t("settings.import.wizard.fieldLabels.visit_date"),
    visit_title: t("settings.import.wizard.fieldLabels.visit_title"),
    visit_status: t("settings.import.wizard.fieldLabels.visit_status"),
    visit_amount: t("settings.import.wizard.fieldLabels.visit_amount"),
    visit_reference: t("settings.import.wizard.fieldLabels.visit_reference"),
    internal_notes: t("settings.import.wizard.fieldLabels.internal_notes"),
  };

  // A pair where the sentence counts something, one template where it does
  // not — see `ImportWizardCopy["issues"]`.
  const issues: Record<ImportIssueCode, string | { one: string; other: string }> = {
    email_invalid: t.raw("settings.import.issues.emailInvalid"),
    card_marked_unverified: t.raw("settings.import.issues.cardMarkedUnverified"),
    specialty_not_gated: t.raw("settings.import.issues.specialtyNotGated"),
    specialty_no_card_number: t.raw("settings.import.issues.specialtyNoCardNumber"),
    specialty_imported_verified: {
      one: t.raw("settings.import.issues.specialtyImportedVerifiedOne"),
      other: t.raw("settings.import.issues.specialtyImportedVerifiedOther"),
    },
    specialty_imported_pending: {
      one: t.raw("settings.import.issues.specialtyImportedPendingOne"),
      other: t.raw("settings.import.issues.specialtyImportedPendingOther"),
    },
    agency_unrecognized: t("settings.import.issues.agencyUnrecognized"),
    level_names_specialty: t.raw("settings.import.issues.levelNamesSpecialty"),
    level_is_technical: t.raw("settings.import.issues.levelIsTechnical"),
    level_not_gated: t.raw("settings.import.issues.levelNotGated"),
    level_no_card_number: t.raw("settings.import.issues.levelNoCardNumber"),
    cert_imported_verified: t("settings.import.issues.certImportedVerified"),
    cert_imported_pending: t("settings.import.issues.certImportedPending"),
    nitrox_imported_verified: t("settings.import.issues.nitroxImportedVerified"),
    nitrox_imported_pending: t("settings.import.issues.nitroxImportedPending"),
    nitrox_no_card_number: t("settings.import.issues.nitroxNoCardNumber"),
    waiver_date_invalid: t.raw("settings.import.issues.waiverDateInvalid"),
    waiver_imported: t("settings.import.issues.waiverImported"),
    dob_invalid: t.raw("settings.import.issues.dobInvalid"),
    visit_date_unreadable: t.raw("settings.import.issues.visitDateUnreadable"),
    visit_no_reference: t("settings.import.issues.visitNoReference"),
    visit_no_date: t("settings.import.issues.visitNoDate"),
    payment_history_date_unreadable: t.raw("settings.import.issues.paymentHistoryDateUnreadable"),
    payment_history_no_date: t("settings.import.issues.paymentHistoryNoDate"),
    no_name: t("settings.import.issues.noName"),
    merged_duplicate: t.raw("settings.import.issues.mergedDuplicate"),
    no_email_new_record: t("settings.import.issues.noEmailNewRecord"),
    size_too_long: t.raw("settings.import.issues.sizeTooLong"),
  };

  const errors: Record<ImportActionErrorCode, string> = {
    not_owner_or_manager: t("settings.import.errors.notOwnerOrManager"),
    csv_required: t("settings.import.errors.csvRequired"),
    no_importable_rows: t("settings.import.errors.noImportableRows"),
    file_too_large: t.raw("settings.import.errors.fileTooLarge"),
    file_empty: t("settings.import.errors.fileEmpty"),
    too_many_columns: t.raw("settings.import.errors.tooManyColumns"),
    too_many_rows: t.raw("settings.import.errors.tooManyRows"),
    cell_too_long_header: t.raw("settings.import.errors.cellTooLongHeader"),
    cell_too_long_row: t.raw("settings.import.errors.cellTooLongRow"),
    no_name_column: t("settings.import.errors.noNameColumn"),
  };

  return {
    heading: t("settings.import.wizard.heading"),
    chooseFile: t("settings.import.wizard.chooseFile"),
    chooseDifferentFile: t("settings.import.wizard.chooseDifferentFile"),
    columnTitle: t.raw("settings.import.wizard.columnTitle"),
    fieldLabels,
    ignoredMedicalColumns: t.raw("settings.import.wizard.ignoredMedicalColumns"),
    unmappedColumns: t.raw("settings.import.wizard.unmappedColumns"),
    waiverRowsNoticeOne: t.raw("settings.import.wizard.waiverRowsNoticeOne"),
    waiverRowsNoticeOther: t.raw("settings.import.wizard.waiverRowsNoticeOther"),
    visitRowsNoticeOne: t.raw("settings.import.wizard.visitRowsNoticeOne"),
    visitRowsNoticeOther: t.raw("settings.import.wizard.visitRowsNoticeOther"),
    paymentHistoryRowsNoticeOne: t.raw("settings.import.wizard.paymentHistoryRowsNoticeOne"),
    paymentHistoryRowsNoticeOther: t.raw("settings.import.wizard.paymentHistoryRowsNoticeOther"),
    bookingsAfterTodayOne: t.raw("settings.import.wizard.bookingsAfterTodayOne"),
    bookingsAfterTodayOther: t.raw("settings.import.wizard.bookingsAfterTodayOther"),
    bookingsAfterTodayMore: t.raw("settings.import.wizard.bookingsAfterTodayMore"),
    sourceSystem,
    stats: {
      diversInFile: t("settings.import.wizard.stats.diversInFile"),
      extraCardRows: t("settings.import.wizard.stats.extraCardRows"),
      skipped: t("settings.import.wizard.stats.skipped"),
      cards: t("settings.import.wizard.stats.cards"),
      specialties: t("settings.import.wizard.stats.specialties"),
      nitroxCards: t("settings.import.wizard.stats.nitroxCards"),
      waivers: t("settings.import.wizard.stats.waivers"),
      pastVisits: t("settings.import.wizard.stats.pastVisits"),
      paymentHistory: t("settings.import.wizard.stats.paymentHistory"),
      internalNotes: t("settings.import.wizard.stats.internalNotes"),
    },
    table: {
      rowNumber: t("settings.import.wizard.table.rowNumber"),
      name: t("settings.import.wizard.table.name"),
      email: t("settings.import.wizard.table.email"),
      card: t("settings.import.wizard.table.card"),
      waiver: t("settings.import.wizard.table.waiver"),
      notes: t("settings.import.wizard.table.notes"),
      noName: t("settings.import.wizard.table.noName"),
      skippedBadge: t("settings.import.wizard.table.skippedBadge"),
      mergedBadge: t.raw("settings.import.wizard.table.mergedBadge"),
      certImported: t("settings.import.wizard.table.certImported"),
      certForReview: t("settings.import.wizard.table.certForReview"),
      certLine: t.raw("settings.import.wizard.table.certLine"),
      specialtyLine: t.raw("settings.import.wizard.table.specialtyLine"),
      waiverAcceptedImported: t("settings.import.wizard.table.waiverAcceptedImported"),
      emptyValue: t("settings.import.wizard.table.emptyValue"),
    },
    previewSwipeHint: t("settings.import.wizard.previewSwipeHint"),
    hiddenRowsNoticeOne: t.raw("settings.import.wizard.hiddenRowsNoticeOne"),
    hiddenRowsNoticeOther: t.raw("settings.import.wizard.hiddenRowsNoticeOther"),
    submitOne: t.raw("settings.import.wizard.submitOne"),
    submitOther: t.raw("settings.import.wizard.submitOther"),
    submitting: t("settings.import.wizard.submitting"),
    issues,
    errors,
    result: {
      summary: t.raw("settings.import.wizard.result.summary"),
      summaryAddedOne: t.raw("settings.import.wizard.result.summaryAddedOne"),
      summaryAddedOther: t.raw("settings.import.wizard.result.summaryAddedOther"),
      summaryUpdatedOne: t.raw("settings.import.wizard.result.summaryUpdatedOne"),
      summaryUpdatedOther: t.raw("settings.import.wizard.result.summaryUpdatedOther"),
      cardsLineOne: t.raw("settings.import.wizard.result.cardsLineOne"),
      cardsLineOther: t.raw("settings.import.wizard.result.cardsLineOther"),
      cardsCertificationsOne: t.raw("settings.import.wizard.result.cardsCertificationsOne"),
      cardsCertificationsOther: t.raw("settings.import.wizard.result.cardsCertificationsOther"),
      cardsSpecialtyOne: t.raw("settings.import.wizard.result.cardsSpecialtyOne"),
      cardsSpecialtyOther: t.raw("settings.import.wizard.result.cardsSpecialtyOther"),
      cardsNitroxOne: t.raw("settings.import.wizard.result.cardsNitroxOne"),
      cardsNitroxOther: t.raw("settings.import.wizard.result.cardsNitroxOther"),
      rowsMergedNote: t.raw("settings.import.wizard.result.rowsMergedNote"),
      cardsSkippedNote: t.raw("settings.import.wizard.result.cardsSkippedNote"),
      rowsSkippedNote: t.raw("settings.import.wizard.result.rowsSkippedNote"),
      cardsHeldByAnother: t.raw("settings.import.wizard.result.cardsHeldByAnother"),
      specialtyGateNote: t("settings.import.wizard.result.specialtyGateNote"),
      waiversLineOne: t.raw("settings.import.wizard.result.waiversLineOne"),
      waiversLineOther: t.raw("settings.import.wizard.result.waiversLineOther"),
      waiversSkippedExistingNote: t.raw("settings.import.wizard.result.waiversSkippedExistingNote"),
      waiversSkippedNoTemplateNoteOne: t.raw(
        "settings.import.wizard.result.waiversSkippedNoTemplateNoteOne",
      ),
      waiversSkippedNoTemplateNoteOther: t.raw(
        "settings.import.wizard.result.waiversSkippedNoTemplateNoteOther",
      ),
      waiverDocumentsFailedNote: t.raw("settings.import.wizard.result.waiverDocumentsFailedNote"),
      visitsLineOne: t.raw("settings.import.wizard.result.visitsLineOne"),
      visitsLineOther: t.raw("settings.import.wizard.result.visitsLineOther"),
      visitsSkippedNote: t.raw("settings.import.wizard.result.visitsSkippedNote"),
      paymentHistoryLineOne: t.raw("settings.import.wizard.result.paymentHistoryLineOne"),
      paymentHistoryLineOther: t.raw("settings.import.wizard.result.paymentHistoryLineOther"),
      paymentHistorySkippedNote: t.raw("settings.import.wizard.result.paymentHistorySkippedNote"),
      receiptDocumentsFailedNote: t.raw("settings.import.wizard.result.receiptDocumentsFailedNote"),
      notesLineOne: t.raw("settings.import.wizard.result.notesLineOne"),
      notesLineOther: t.raw("settings.import.wizard.result.notesLineOther"),
      sizesDeclinedLineOne: t.raw("settings.import.wizard.result.sizesDeclinedLineOne"),
      sizesDeclinedLineOther: t.raw("settings.import.wizard.result.sizesDeclinedLineOther"),
      seeRoster: t("settings.import.wizard.result.seeRoster"),
    },
  };
}
