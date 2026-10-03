import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { type NoticeTone, noticeFromParam } from "@/lib/staff-notices";
import { CsvFileInput } from "../_components/CsvFileInput";
import { restoreDiveSitesAction } from "./dive-site-actions";

/**
 * Kebab, because `noticeUrl` writes kebab: `noticeCode` lowercases the value
 * and replaces every `_`, so a map keyed on the parser's own `unknown_columns`
 * matches nothing and renders no banner at all — which looks exactly like the
 * import having silently worked.
 */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  "import-empty": { tone: "danger", key: "diveSites.notice.importEmpty" },
  "import-unknown-columns": { tone: "danger", key: "diveSites.notice.importUnknownColumns" },
  "import-no-name-column": { tone: "danger", key: "diveSites.notice.importNoNameColumn" },
  "import-file-empty": { tone: "danger", key: "diveSites.notice.importFileEmpty" },
  "import-file-too-large": { tone: "danger", key: "diveSites.notice.importFileTooLarge" },
  "import-too-many-rows": { tone: "danger", key: "diveSites.notice.importTooManyRows" },
  "import-too-many-columns": { tone: "danger", key: "diveSites.notice.importTooManyColumns" },
  "import-cell-too-long": { tone: "danger", key: "diveSites.notice.importCellTooLong" },
};

/**
 * Import's "Dive sites" tab: **the other half of `dive_sites.csv`** (issue
 * #1771). The bundle carried the shop's whole library and nothing could read
 * one back. No template to download, unlike the other two tabs: those read a
 * competitor's file and a template is how a shop knows what to put in it,
 * while the only file this accepts is one DiveDay wrote.
 */
export function DiveSiteImportPanel({ t, notice }: { t: StaffTranslator; notice?: string }) {
  const imported = notice?.match(/^imported-(\d+)-(\d+)-(\d+)-(\d+)$/);
  const banner = noticeFromParam(notice, NOTICES);

  return (
    <>
      {imported ? (
        <StaffNoticeBanner tone="success">
          {t("diveSites.notice.imported", {
            updated: imported[1],
            created: imported[2],
            deleted: imported[3],
            skipped: imported[4],
          })}
        </StaffNoticeBanner>
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <SectionCard padding="lg">
        <p className="text-sm text-muted">{t("diveSites.import.description")}</p>
        <p className="mt-3 text-sm text-muted">{t("diveSites.import.help")}</p>
        <p className="mt-3 text-sm text-muted">{t("diveSites.import.notRestored")}</p>
        <form
          action={restoreDiveSitesAction}
          encType="multipart/form-data"
          className="mt-5 flex flex-wrap items-end gap-3"
        >
          {/* The picker the other tabs use: a secondary `md` button in the
              shop's language, the height of the submit beside it. A bare file
              input in a text-box outline read "Choose File No file chosen" as
              plain text in a box, with no hover (K-350). */}
          <CsvFileInput
            name="file"
            required
            copy={{
              choose: t("diveSites.import.chooseFile"),
              chooseAnother: t("diveSites.import.chooseDifferentFile"),
            }}
          />
          <SubmitButton
            pendingLabel={t("diveSites.import.pending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("diveSites.import.submit")}
          </SubmitButton>
        </form>
      </SectionCard>
    </>
  );
}
