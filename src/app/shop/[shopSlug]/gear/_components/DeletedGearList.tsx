import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { DeletedGearItemRow } from "@/db/gear";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";
import { restoreGearItemAction } from "../actions";

/**
 * The units that have been deleted, newest first, each with the one act this
 * list exists for. The same ledger rows as the register above, with no group
 * heading over them: the active Deleted chip is what says which view this is,
 * and repeating the word underneath it would be the shared fact said twice
 * (ADR 20260827-the-shops-shelves).
 *
 * The row is a door to the unit's own record, which reads as a read-only
 * history while the unit is deleted (issue #614) — so "when was this last
 * serviced" no longer costs a restore-and-delete round trip.
 */
export function DeletedList({
  rows,
  shopSlug,
  t,
  locale,
  timeZone,
}: {
  rows: DeletedGearItemRow[];
  shopSlug: string;
  t: StaffTranslator;
  locale: string;
  timeZone: string;
}) {
  return (
    <ul className="mt-6">
      {rows.map((row) => (
        <LedgerRow
          key={row.id}
          href={`/shop/${shopSlug}/gear/${row.id}`}
          linkLabel={row.label}
          trailing={
            <form action={restoreGearItemAction}>
              <input type="hidden" name="gearItemId" value={row.id} />
              <SubmitButton
                ariaLabel={t("gear.deleted.restoreUnit", { label: row.label })}
                pendingLabel={t("gear.deleted.restoring")}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {t("gear.deleted.restore")}
              </SubmitButton>
            </form>
          }
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-sm font-medium">{row.label}</span>
            <span className="text-sm text-muted">
              {[gearItemKindLabel(t, row.kind), row.size].filter(Boolean).join(" · ")}
            </span>
            <span className="text-sm text-muted">
              {t("gear.deleted.on", { date: formatShortDate(row.deletedAt, locale, timeZone) })}
            </span>
          </div>
        </LedgerRow>
      ))}
    </ul>
  );
}
