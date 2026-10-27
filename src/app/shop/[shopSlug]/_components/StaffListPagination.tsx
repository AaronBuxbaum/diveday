import { Pager, staffPagerWords } from "@/components/Pager";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";

/** A printed list states its subset; web page numbers belong to the screen. */
export function StaffListPagination({
  t,
  scope,
  pagination,
  totalLabel,
  href,
}: {
  t: StaffTranslator;
  scope: { key: StaffMessageKey; shown: number };
  pagination: { page: number; pageCount: number; total: number };
  /** Omit when the screen toolbar already names the filtered total. */
  totalLabel?: string;
  href: (page: number) => string;
}) {
  return (
    <>
      <p className="mt-4 hidden text-sm text-muted print:block">
        {t(scope.key, { shown: scope.shown, total: pagination.total })}
      </p>
      <div className="print:hidden">
        <Pager
          page={pagination.page}
          pageCount={pagination.pageCount}
          href={href}
          total={totalLabel}
          words={staffPagerWords(t)}
        />
      </div>
    </>
  );
}
