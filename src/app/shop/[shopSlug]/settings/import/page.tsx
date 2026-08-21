import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { canPersonImportShopData } from "@/db/import";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import {
  IMPORT_HONESTY_TABLE,
  type ImportField,
  type ImportIssueCode,
  type ImportScopeRowId,
} from "@/lib/import";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import type { ImportActionErrorCode } from "./actions";
import { ImportWizard } from "./ImportWizard";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

/**
 * Every word the client-side wizard renders, resolved on the server — a staff
 * Client Component takes copy as props, never a translator (see
 * `src/i18n/staff-messages.ts`).
 */
function importWizardCopy(t: StaffTranslator) {
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

  const issues: Record<ImportIssueCode, string> = {
    email_invalid: t.raw("settings.import.issues.emailInvalid"),
    card_marked_unverified: t.raw("settings.import.issues.cardMarkedUnverified"),
    specialty_not_gated: t.raw("settings.import.issues.specialtyNotGated"),
    specialty_no_card_number: t.raw("settings.import.issues.specialtyNoCardNumber"),
    specialty_imported_verified: t.raw("settings.import.issues.specialtyImportedVerified"),
    specialty_imported_pending: t.raw("settings.import.issues.specialtyImportedPending"),
    agency_unrecognized: t("settings.import.issues.agencyUnrecognized"),
    level_names_specialty: t.raw("settings.import.issues.levelNamesSpecialty"),
    level_is_technical: t.raw("settings.import.issues.levelIsTechnical"),
    level_not_gated: t.raw("settings.import.issues.levelNotGated"),
    level_no_card_number: t.raw("settings.import.issues.levelNoCardNumber"),
    cert_imported_verified: t("settings.import.issues.certImportedVerified"),
    cert_imported_pending: t("settings.import.issues.certImportedPending"),
    nitrox_imported: t("settings.import.issues.nitroxImported"),
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
    waiverRowsNotice: t.raw("settings.import.wizard.waiverRowsNotice"),
    visitRowsNotice: t.raw("settings.import.wizard.visitRowsNotice"),
    paymentHistoryRowsNotice: t.raw("settings.import.wizard.paymentHistoryRowsNotice"),
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
    hiddenRowsNotice: t.raw("settings.import.wizard.hiddenRowsNotice"),
    submit: t.raw("settings.import.wizard.submit"),
    submitting: t("settings.import.wizard.submitting"),
    issues,
    errors,
    result: {
      summary: t.raw("settings.import.wizard.result.summary"),
      cardsLine: t.raw("settings.import.wizard.result.cardsLine"),
      rowsMergedNote: t.raw("settings.import.wizard.result.rowsMergedNote"),
      cardsSkippedNote: t.raw("settings.import.wizard.result.cardsSkippedNote"),
      rowsSkippedNote: t.raw("settings.import.wizard.result.rowsSkippedNote"),
      cardsHeldByAnother: t.raw("settings.import.wizard.result.cardsHeldByAnother"),
      specialtyGateNote: t("settings.import.wizard.result.specialtyGateNote"),
      waiversLine: t.raw("settings.import.wizard.result.waiversLine"),
      waiversSkippedExistingNote: t.raw("settings.import.wizard.result.waiversSkippedExistingNote"),
      waiversSkippedNoTemplateNote: t.raw(
        "settings.import.wizard.result.waiversSkippedNoTemplateNote",
      ),
      waiverDocumentsFailedNote: t.raw("settings.import.wizard.result.waiverDocumentsFailedNote"),
      visitsLine: t.raw("settings.import.wizard.result.visitsLine"),
      visitsSkippedNote: t.raw("settings.import.wizard.result.visitsSkippedNote"),
      paymentHistoryLine: t.raw("settings.import.wizard.result.paymentHistoryLine"),
      paymentHistorySkippedNote: t.raw("settings.import.wizard.result.paymentHistorySkippedNote"),
      receiptDocumentsFailedNote: t.raw("settings.import.wizard.result.receiptDocumentsFailedNote"),
      notesLine: t.raw("settings.import.wizard.result.notesLine"),
      seeRoster: t("settings.import.wizard.result.seeRoster"),
    },
  };
}

export const metadata: Metadata = { title: "Import contacts — DiveDay" };

/**
 * This surface's words for {@link IMPORT_HONESTY_TABLE}'s rows — the staff
 * bundle's map, mirroring the diver-bundle `IMPORT_SCOPE_ROW_KEYS` the
 * /switching pages use (one bundle per surface; the table's rows and buckets
 * stay the single source in src/lib/import.ts).
 */
const SCOPE_ROW_KEYS: Record<ImportScopeRowId, { what: StaffMessageKey; detail: StaffMessageKey }> =
  {
    contact: {
      what: "settings.import.scopeTable.contact.what",
      detail: "settings.import.scopeTable.contact.detail",
    },
    emergencyContact: {
      what: "settings.import.scopeTable.emergencyContact.what",
      detail: "settings.import.scopeTable.emergencyContact.detail",
    },
    diveInsurance: {
      what: "settings.import.scopeTable.diveInsurance.what",
      detail: "settings.import.scopeTable.diveInsurance.detail",
    },
    rentalSizes: {
      what: "settings.import.scopeTable.rentalSizes.what",
      detail: "settings.import.scopeTable.rentalSizes.detail",
    },
    certificationCard: {
      what: "settings.import.scopeTable.certificationCard.what",
      detail: "settings.import.scopeTable.certificationCard.detail",
    },
    specialtyCards: {
      what: "settings.import.scopeTable.specialtyCards.what",
      detail: "settings.import.scopeTable.specialtyCards.detail",
    },
    nitrox: {
      what: "settings.import.scopeTable.nitrox.what",
      detail: "settings.import.scopeTable.nitrox.detail",
    },
    signedWaivers: {
      what: "settings.import.scopeTable.signedWaivers.what",
      detail: "settings.import.scopeTable.signedWaivers.detail",
    },
    waiverDocuments: {
      what: "settings.import.scopeTable.waiverDocuments.what",
      detail: "settings.import.scopeTable.waiverDocuments.detail",
    },
    role: {
      what: "settings.import.scopeTable.role.what",
      detail: "settings.import.scopeTable.role.detail",
    },
    cardOnFile: {
      what: "settings.import.scopeTable.cardOnFile.what",
      detail: "settings.import.scopeTable.cardOnFile.detail",
    },
    pastVisits: {
      what: "settings.import.scopeTable.pastVisits.what",
      detail: "settings.import.scopeTable.pastVisits.detail",
    },
    paymentHistory: {
      what: "settings.import.scopeTable.paymentHistory.what",
      detail: "settings.import.scopeTable.paymentHistory.detail",
    },
    serviceHistory: {
      what: "settings.import.scopeTable.serviceHistory.what",
      detail: "settings.import.scopeTable.serviceHistory.detail",
    },
    diverNotes: {
      what: "settings.import.scopeTable.diverNotes.what",
      detail: "settings.import.scopeTable.diverNotes.detail",
    },
  };

/**
 * Built inside the request, not at module scope, so the chip text tracks the
 * negotiated locale rather than freezing to whichever locale first imported
 * this file.
 */
function scopeChip(
  t: StaffTranslator,
): Record<(typeof IMPORT_HONESTY_TABLE)[number]["scope"], { label: string; className: string }> {
  return {
    included: {
      label: t("settings.import.scopeChip.included"),
      className: "bg-success/10 text-success-strong",
    },
    "stays-behind": {
      label: t("settings.import.scopeChip.staysBehind"),
      // `bg-surface`, not the `bg-surface-sunken` the /switching guides use for
      // this same chip: the rows here are themselves sunken, so a sunken chip
      // was drawn in the exact colour of the row behind it and every
      // "Stays behind" pill read as bare grey text next to a filled green one.
      className: "bg-surface text-muted",
    },
  };
}

/**
 * The intake side of the portability wedge (ADR 20260723-contact-importer):
 * bring a shop's people, cards, and sizes in from a CSV — and say plainly, up
 * front, what does and doesn't come across. Gated to owner/manager like the
 * export, and re-checked against the database in the commit action.
 */
export default async function ImportContactsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug } = await params;
  const db = await getDb();

  if (!(await canPersonImportShopData(db, session.user.shopId, session.user.personId))) {
    // Settings, not Today — Import is a Settings sub-page, and its parent is
    // where the refusal is legible. Same pattern as promos/WhatsApp/team.
    redirect(noticeUrl(shopPath(shopSlug), "import-not-authorized"));
  }

  const shop = await getShopById(db, session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  const chips = scopeChip(t);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("settings.import.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("settings.import.title")}
        description={t("settings.import.description")}
      />

      <p className="-mt-2 mb-6 text-sm text-muted">
        {t.rich("settings.import.comingFrom", {
          eve: (chunks) => (
            <a href="/switching/eve" target="_blank" rel="noreferrer" className="underline">
              {chunks}
            </a>
          ),
          diveshop360: (chunks) => (
            <a href="/switching/diveshop360" target="_blank" rel="noreferrer" className="underline">
              {chunks}
            </a>
          ),
          spreadsheet: (chunks) => (
            <a href="/switching/spreadsheet" target="_blank" rel="noreferrer" className="underline">
              {chunks}
            </a>
          ),
        })}
      </p>

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        <SectionCard padding="lg" title={t("settings.import.comesAcross.heading")}>
          <ul className="space-y-2">
            {IMPORT_HONESTY_TABLE.map((row) => (
              <li
                key={row.id}
                className="grid gap-1 rounded-xl bg-surface-sunken px-4 py-3 sm:grid-cols-[10rem_7rem_1fr] sm:items-baseline sm:gap-3"
              >
                <span className="font-medium text-foreground">
                  {t(SCOPE_ROW_KEYS[row.id].what)}
                </span>
                <span>
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${chips[row.scope].className}`}
                  >
                    {chips[row.scope].label}
                  </span>
                </span>
                <span className="text-sm text-muted">{t(SCOPE_ROW_KEYS[row.id].detail)}</span>
              </li>
            ))}
          </ul>
        </SectionCard>

        <ImportWizard
          diversHref={`/shop/${shopSlug}/divers`}
          intro={t.rich("settings.import.wizard.intro", {
            mono: (chunks) => <span className="font-mono">{chunks}</span>,
          })}
          copy={importWizardCopy(t)}
        />
      </div>
    </main>
  );
}
