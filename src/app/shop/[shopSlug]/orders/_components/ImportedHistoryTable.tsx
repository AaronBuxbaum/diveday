import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import type { getOrdersIndex } from "@/features/orders-index";
import type { StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { isManagedStorageUrl } from "@/lib/storage";

type ImportedRows = NonNullable<
  Awaited<ReturnType<typeof getOrdersIndex>>["importedHistoryPage"]
>["rows"];

const IMPORTED_PAYMENT_DIRECTION_KEYS: Record<"payment" | "refund" | "unknown", StaffMessageKey> = {
  payment: "orders.index.importedHistory.direction.payment",
  refund: "orders.index.importedHistory.direction.refund",
  unknown: "orders.index.importedHistory.direction.unknown",
};

/** A source URL is rendered only after import re-stored it, or when it is a same-origin legacy path. */
function safeImportedDocumentUrl(url: string | null): string | null {
  if (!url) return null;
  return url.startsWith("/") || isManagedStorageUrl(url) ? url : null;
}

/** The imported-history table of the orders page: the diver leads each row on a phone, with the title and date folded under the name. */
export function ImportedHistoryTable({
  rows,
  shopSlug,
  locale,
  t,
}: {
  rows: ImportedRows;
  shopSlug: string;
  locale: string;
  t: ReturnType<typeof staffTranslator>;
}) {
  return (
    <Table shellClassName="mt-4">
      <THead>
        <Th>{t("orders.index.table.diver")}</Th>
        <Th hideBelow="sm">{t("orders.index.importedHistory.table.source")}</Th>
        <Th hideBelow="sm">{t("orders.index.importedHistory.table.status")}</Th>
        {/* Below `sm` the date folds under the name with the title, so
            the diver keeps the row's width instead of a third of it
            ("Hana / Kobayashi / Two-tank / morning", `orders-imported-history-open`). */}
        <Th hideBelow="sm">{t("orders.index.table.date")}</Th>
        <Th numeric width="8rem">
          {t("orders.index.table.amount")}
        </Th>
      </THead>
      <TBody>
        {rows.map(({ history, person }) => {
          const receiptDocumentUrl = safeImportedDocumentUrl(history.receiptDocumentUrl);
          return (
            <Tr key={history.id}>
              <Td align="middle">
                <RowLink
                  href={`/shop/${shopSlug}/divers/${person.id}`}
                  className="text-base font-medium text-foreground hover:text-primary hover:underline sm:text-sm"
                >
                  {person.fullName}
                </RowLink>
                <div className="mt-1 text-base text-muted sm:hidden">
                  {history.title ?? history.sourceReference ?? "—"}
                </div>
                <div className="mt-0.5 text-sm text-muted tabular-nums sm:hidden">
                  {formatCalendarDate(history.occurredOn, locale)}
                </div>
              </Td>
              {/* The section badge marks all rows as unverified; the receipt
                  reference labels its document link when available. */}
              <Td muted hideBelow="sm" align="middle">
                <div className="text-base sm:text-sm">
                  {history.title ?? history.sourceReference ?? "—"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  {history.sourceLabel ? <span>{history.sourceLabel}</span> : null}
                  {receiptDocumentUrl ? (
                    <a
                      href={receiptDocumentUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      {history.receiptReference
                        ? t("orders.index.importedHistory.receiptReference", {
                            reference: history.receiptReference,
                          })
                        : t("orders.index.importedHistory.openReceipt")}
                    </a>
                  ) : history.receiptReference ? (
                    <span>
                      {t("orders.index.importedHistory.receiptReference", {
                        reference: history.receiptReference,
                      })}
                    </span>
                  ) : null}
                </div>
              </Td>
              <Td hideBelow="sm" align="middle">
                <div>{t(IMPORTED_PAYMENT_DIRECTION_KEYS[history.direction])}</div>
                {history.statusLabel ? (
                  <div className="mt-1 text-xs text-muted">{history.statusLabel}</div>
                ) : null}
                {history.stripeReference ? (
                  <div className="mt-1 text-xs text-muted">
                    {t("orders.index.importedHistory.stripeReference", {
                      reference: history.stripeReference,
                    })}
                  </div>
                ) : null}
              </Td>
              <Td muted hideBelow="sm" align="middle" className="whitespace-nowrap tabular-nums">
                {formatCalendarDate(history.occurredOn, locale)}
              </Td>
              <Td numeric align="middle" className="text-base sm:text-sm">
                {history.amountLabel ?? t("orders.index.importedHistory.amountNotProvided")}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </Table>
  );
}
