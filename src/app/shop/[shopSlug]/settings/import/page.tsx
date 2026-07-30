import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { canPersonImportShopData } from "@/db/import";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { IMPORT_HONESTY_TABLE, type ImportField } from "@/lib/import";
import { requireStaffSession } from "@/lib/session";
import { ImportWizard } from "./ImportWizard";

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
    certification_expires_at: t("settings.import.wizard.fieldLabels.certification_expires_at"),
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
    visit_date: t("settings.import.wizard.fieldLabels.visit_date"),
    visit_title: t("settings.import.wizard.fieldLabels.visit_title"),
    visit_status: t("settings.import.wizard.fieldLabels.visit_status"),
    visit_amount: t("settings.import.wizard.fieldLabels.visit_amount"),
    visit_reference: t("settings.import.wizard.fieldLabels.visit_reference"),
  };

  return {
    heading: t("settings.import.wizard.heading"),
    chooseFile: t("settings.import.wizard.chooseFile"),
    chooseDifferentFile: t("settings.import.wizard.chooseDifferentFile"),
    columnTitle: t("settings.import.wizard.columnTitle"),
    fieldLabels,
    ignoredMedicalColumns: t("settings.import.wizard.ignoredMedicalColumns"),
    unmappedColumns: t("settings.import.wizard.unmappedColumns"),
    waiverRowsNotice: t("settings.import.wizard.waiverRowsNotice"),
    visitRowsNotice: t("settings.import.wizard.visitRowsNotice"),
    stats: {
      diversInFile: t("settings.import.wizard.stats.diversInFile"),
      extraCardRows: t("settings.import.wizard.stats.extraCardRows"),
      skipped: t("settings.import.wizard.stats.skipped"),
      cards: t("settings.import.wizard.stats.cards"),
      specialties: t("settings.import.wizard.stats.specialties"),
      nitroxCards: t("settings.import.wizard.stats.nitroxCards"),
      waivers: t("settings.import.wizard.stats.waivers"),
      pastVisits: t("settings.import.wizard.stats.pastVisits"),
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
      mergedBadge: t("settings.import.wizard.table.mergedBadge"),
      certImported: t("settings.import.wizard.table.certImported"),
      certForReview: t("settings.import.wizard.table.certForReview"),
      certLine: t("settings.import.wizard.table.certLine"),
      specialtyLine: t("settings.import.wizard.table.specialtyLine"),
      waiverAcceptedImported: t("settings.import.wizard.table.waiverAcceptedImported"),
      emptyValue: t("settings.import.wizard.table.emptyValue"),
    },
    hiddenRowsNotice: t("settings.import.wizard.hiddenRowsNotice"),
    submit: t("settings.import.wizard.submit"),
    submitting: t("settings.import.wizard.submitting"),
    result: {
      summary: t("settings.import.wizard.result.summary"),
      cardsLine: t("settings.import.wizard.result.cardsLine"),
      rowsMergedNote: t("settings.import.wizard.result.rowsMergedNote"),
      cardsSkippedNote: t("settings.import.wizard.result.cardsSkippedNote"),
      rowsSkippedNote: t("settings.import.wizard.result.rowsSkippedNote"),
      cardsHeldByAnother: t("settings.import.wizard.result.cardsHeldByAnother"),
      specialtyGateNote: t("settings.import.wizard.result.specialtyGateNote"),
      waiversLine: t("settings.import.wizard.result.waiversLine"),
      waiversSkippedExistingNote: t("settings.import.wizard.result.waiversSkippedExistingNote"),
      waiversSkippedNoTemplateNote: t("settings.import.wizard.result.waiversSkippedNoTemplateNote"),
      waiverDocumentsFailedNote: t("settings.import.wizard.result.waiverDocumentsFailedNote"),
      visitsLine: t("settings.import.wizard.result.visitsLine"),
      visitsSkippedNote: t("settings.import.wizard.result.visitsSkippedNote"),
      seeRoster: t("settings.import.wizard.result.seeRoster"),
    },
  };
}

export const metadata: Metadata = { title: "Import contacts — DiveDay" };

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
      className: "bg-success/10 text-success",
    },
    "stays-behind": {
      label: t("settings.import.scopeChip.staysBehind"),
      className: "bg-surface-sunken text-muted",
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
    redirect(`/shop/${shopSlug}`);
  }

  const shop = await getShopById(db, session.user.shopId);
  const t = staffTranslator(await requestLocale(shop?.defaultLocale));
  const chips = scopeChip(t);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("settings.import.eyebrow")}
        title={t("settings.import.title")}
        description={t("settings.import.description")}
      />

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-lg font-semibold">{t("settings.import.comesAcross.heading")}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          {t("settings.import.comesAcross.description")}
        </p>
        <ul className="mt-4 space-y-2">
          {IMPORT_HONESTY_TABLE.map((row) => (
            <li
              key={row.what}
              className="grid gap-1 rounded-xl bg-surface-sunken px-4 py-3 sm:grid-cols-[10rem_7rem_1fr] sm:items-baseline sm:gap-3"
            >
              <span className="font-medium text-foreground">{row.what}</span>
              <span>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${chips[row.scope].className}`}
                >
                  {chips[row.scope].label}
                </span>
              </span>
              <span className="text-sm text-muted">{row.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6">
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
