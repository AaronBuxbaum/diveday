import { PrintButton } from "@/components/PrintButton";
import { EYEBROW_CLASS, EyebrowBackLink } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  formatDateTimeTz,
  formatShortDate,
  formatTimeRangeTz,
  formatTimeZoneName,
} from "@/lib/format";
import type { IncidentExportDocument } from "@/lib/incident-export";
import { shopPath } from "@/lib/staff-notices";

export function DepartureLogHeader({
  doc,
  locale,
  t,
}: {
  doc: IncidentExportDocument;
  locale: string;
  t: StaffTranslator;
}) {
  const { shopSlug, tripId } = doc.meta;
  const dateTime = (iso: string) => formatDateTimeTz(new Date(iso), locale, doc.meta.timezone);
  return (
    <header className="border-b border-border pb-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* On screen the eyebrow is the way back to the departure this
                documents, in the word its own tab uses; the only link up used
                to be a ghost button beside Print, and it went to Today rather
                than to the departure (principle 10, issue #823). On paper the
                same line names the document instead: a record handed to an
                insurer has to say what it is, and it has no navigation. */}
          <EyebrowBackLink href={shopPath(shopSlug, "trips", tripId)} className="print:hidden">
            {t("trips.surfaces.trip")}
          </EyebrowBackLink>
          <p className={`hidden ${EYEBROW_CLASS} print:block`}>{t("incidentExport.title")}</p>
          <h1 className={`mt-1 ${SHELL_TITLE_CLASS}`}>{doc.meta.tripTitle}</h1>
          {/* Each dot is glued to what it follows by a no-break space, so a
                wrap falls after one and never starts a line with it. */}
          <p className="mt-1 text-muted">
            {formatShortDate(new Date(doc.meta.tripStartsAt), locale, doc.meta.timezone)}
            {"\u00a0"}·{" "}
            {formatTimeRangeTz(
              new Date(doc.meta.tripStartsAt),
              new Date(doc.meta.tripEndsAt),
              locale,
              doc.meta.timezone,
            )}
            {"\u00a0"}· {doc.meta.shopName}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 print:hidden">
          <PrintButton label={t("shared.printButton.label")} />
        </div>
      </div>
      {/* **One paragraph about the document itself** (visual review
            2026-10-24, B52): what it is, that it states facts and judges none,
            who generated it and when, and the zone every time on it is in. It
            was four, with the disclaimer in bold, before the first fact. */}
      <p className="mt-3 max-w-prose text-sm text-muted">
        {t("incidentExport.preamble", {
          date: dateTime(doc.meta.generatedAt),
          name: doc.meta.generatedByName,
          timezone: formatTimeZoneName(locale, doc.meta.timezone),
        })}
      </p>
    </header>
  );
}
