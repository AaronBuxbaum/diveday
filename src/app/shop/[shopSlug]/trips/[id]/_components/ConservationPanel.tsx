import { DisclosureRow as Disclosure } from "@/components/ui/disclosure";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { getTripConservationPanel } from "@/db/trip-conservation";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { cachedFormatter } from "@/lib/intl-cache";
import { ConservationActions } from "./ConservationActions";
import { type ConservationCopy, ConservationForm } from "./ConservationForm";

export function ConservationPanel({
  panel,
  tripId,
  shopSlug,
  t,
  locale,
  timeZone,
}: {
  panel: Awaited<ReturnType<typeof getTripConservationPanel>>;
  tripId: string;
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  if (!panel) return null;
  const copy: ConservationCopy = {
    kind: t("trips.conservation.kind"),
    quantity: t("trips.conservation.quantity"),
    location: t("trips.conservation.location"),
    note: t("trips.conservation.note"),
    save: t("trips.conservation.save"),
    add: t("trips.conservation.add"),
    pending: t("words.busy.saving"),
    delete: t("trips.conservation.delete"),
    deleted: t("trips.conservation.deleted"),
    undo: t("shared.undoToast.undo"),
    dismiss: t("shared.undoToast.dismiss"),
    saved: t("trips.conservation.saved"),
    kinds: {
      litter_kg: t("trips.conservation.kinds.litter_kg"),
      litter_items: t("trips.conservation.kinds.litter_items"),
      line_m: t("trips.conservation.kinds.line_m"),
    },
    errors: {
      invalid: t("trips.conservation.errors.invalid"),
      not_authorized: t("trips.conservation.errors.not_authorized"),
      unavailable: t("trips.conservation.errors.unavailable"),
      not_returned: t("trips.conservation.errors.not_returned"),
      stale: t("trips.conservation.errors.stale"),
    },
  };
  return (
    <section aria-labelledby="conservation-heading" className="space-y-4">
      <h2 id="conservation-heading" className={SECTION_TITLE_CLASS}>
        {t("trips.conservation.heading")}
      </h2>
      <p className="max-w-prose text-sm text-muted">{t("trips.conservation.hint")}</p>
      <ConservationActions tripId={tripId} shopSlug={shopSlug} copy={copy}>
        {panel.rows.length === 0 ? (
          <p className="text-sm text-muted">{t("trips.conservation.empty")}</p>
        ) : (
          <ul className="divide-y divide-border">
            {panel.rows.map((row) => (
              <li key={row.id} className="space-y-2 py-4">
                <p className="font-medium">
                  {copy.kinds[row.kind]} ·{" "}
                  {cachedFormatter("number", Intl.NumberFormat, locale, {
                    maximumFractionDigits: 2,
                  }).format(row.quantity)}
                  {row.location ? ` · ${row.location}` : ""}
                </p>
                {row.note ? <p className="text-sm">{row.note}</p> : null}
                <p className="text-xs text-muted">
                  {t("trips.conservation.recorded", {
                    when: formatDateTimeTz(row.updatedAt, locale, timeZone),
                    zone: timeZone,
                  })}
                </p>
                {panel.editable ? (
                  <Disclosure id={`conservation-${row.id}`} heading={t("trips.conservation.edit")}>
                    <ConservationForm key={row.revision} tripId={tripId} row={row} copy={copy} />
                  </Disclosure>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {panel.editable ? (
          <Disclosure id="conservation-add" heading={t("trips.conservation.add")}>
            <ConservationForm tripId={tripId} copy={copy} />
          </Disclosure>
        ) : (
          <p className="text-sm text-muted">{t("trips.conservation.afterReturn")}</p>
        )}
      </ConservationActions>
    </section>
  );
}
