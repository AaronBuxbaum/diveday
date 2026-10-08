import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { CsvFileInput } from "../_components/CsvFileInput";
import { importGearServiceHistoryAction } from "./gear-actions";

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "import-empty": { tone: "danger", key: "gear.notice.importEmpty" },
  // Kebab, because `noticeUrl` writes kebab — `noticeCode` replaces every `_`,
  // so this key spelled `import-no_gear_column` matched nothing and a shop
  // whose CSV had no gear-tag column saw no banner at all (issue #1771).
  "import-no-gear-column": { tone: "danger", key: "gear.notice.importNoGearColumn" },
  "import-file-empty": { tone: "danger", key: "gear.notice.importFileEmpty" },
  // The four caps `prepareGearImport` shares with the contacts importer
  // (issue #1846); a refused file with no banner reads as a silent success.
  "import-file-too-large": { tone: "danger", key: "gear.notice.importFileTooLarge" },
  "import-too-many-rows": { tone: "danger", key: "gear.notice.importTooManyRows" },
  "import-too-many-columns": { tone: "danger", key: "gear.notice.importTooManyColumns" },
  "import-cell-too-long": { tone: "danger", key: "gear.notice.importCellTooLong" },
};

/**
 * Import's "Gear history" tab: bulk CSV import for the fleet and its dated
 * service records. It had a Settings page of its own beside the contacts
 * importer until the three importers became one page with a tab each (Aaron,
 * 2026-10-03). Gated owner/manager by the page, and again in the action.
 */
export function GearImportPanel({ t, notice }: { t: StaffTranslator; notice?: string }) {
  const importedMatch = notice?.match(/^imported-(\d+)-(\d+)-(\d+)-(\d+)-(\d+)$/);
  const banner = noticeFromParam(notice, NOTICES);

  return (
    <>
      {importedMatch ? (
        <StaffNoticeBanner tone="success">
          {t("gear.notice.imported", {
            events: importedMatch[1],
            units: importedMatch[2],
            skipped: importedMatch[3],
            assignments: importedMatch[4],
            assignmentSkipped: importedMatch[5],
          })}
        </StaffNoticeBanner>
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <SectionCard padding="lg">
        <p className="text-sm text-muted">{t("gear.import.help")}</p>
        <a
          className={buttonClass({ variant: "secondary", className: "mt-4" })}
          href="/diveday-gear-service-import-template.csv"
          download
        >
          {t("gear.import.downloadTemplate")}
        </a>
        <form
          action={importGearServiceHistoryAction}
          encType="multipart/form-data"
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          {/* The same control the Divers tab uses, not the operating system's
              grey "Choose File / No file chosen". */}
          <CsvFileInput
            name="file"
            required
            copy={{
              choose: t("gear.import.chooseFile"),
              chooseAnother: t("gear.import.chooseDifferentFile"),
            }}
          />
          <SubmitButton
            pendingLabel={t("gear.import.pending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("gear.import.submit")}
          </SubmitButton>
        </form>
      </SectionCard>
    </>
  );
}
