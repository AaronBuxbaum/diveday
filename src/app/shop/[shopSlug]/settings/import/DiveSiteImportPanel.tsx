import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SectionCard } from "@/components/ui/card";
import type { NoticeTone } from "@/components/ui/tone";
import {
  DIVE_SITE_CREATURE_IMPORT_COLUMNS,
  DIVE_SITE_IMPORT_COLUMNS,
} from "@/features/sites/dive-sites";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { noticeFromParam } from "@/lib/staff-notices";
import { ExistingImportReview } from "./ExistingImportReview";
import { existingImportCopy } from "./existing-import-copy";

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
  "import-wrong-files": { tone: "danger", key: "diveSites.notice.importWrongFiles" },
  "import-creatures-refused": { tone: "danger", key: "diveSites.notice.importCreaturesRefused" },
};

/**
 * Import's "Dive sites" tab: **the other half of `dive_sites.csv`** (issue
 * #1771). The bundle carried the shop's whole library and nothing could read
 * one back. No template to download, unlike the other two tabs: those read a
 * competitor's file and a template is how a shop knows what to put in it,
 * while the only file this accepts is one DiveDay wrote.
 */
export function DiveSiteImportPanel({ t, notice }: { t: StaffTranslator; notice?: string }) {
  // The last two numbers are the field guides, present only when the upload
  // carried dive_site_creatures.csv (issue #1841).
  const imported = notice?.match(/^imported-(\d+)-(\d+)-(\d+)-(\d+)(?:-(\d+)-(\d+))?$/);
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
          {imported[5] !== undefined
            ? ` ${t("diveSites.notice.importedGuides", {
                guides: imported[5],
                dropped: imported[6] ?? "0",
              })}`
            : null}
        </StaffNoticeBanner>
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <SectionCard padding="lg">
        <p className="text-sm text-muted">{t("diveSites.import.description")}</p>
        <p className="mt-3 text-sm text-muted">{t("diveSites.import.help")}</p>
        <p className="mt-3 text-sm text-muted">{t("diveSites.import.notRestored")}</p>
        <ExistingImportReview
          kind="sites"
          columns={{
            sites: DIVE_SITE_IMPORT_COLUMNS,
            creatures: DIVE_SITE_CREATURE_IMPORT_COLUMNS,
          }}
          copy={existingImportCopy(t, "sites")}
        />
      </SectionCard>
    </>
  );
}
