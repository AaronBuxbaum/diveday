import { Pager, staffPagerWords } from "@/components/Pager";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** A staff list's pager, in the staff app's words. */
export function StaffListPagination({
  t,
  pagination,
  totalLabel,
  href,
}: {
  t: StaffTranslator;
  pagination: { page: number; pageCount: number; total: number };
  /** Omit when the screen toolbar already names the filtered total. */
  totalLabel?: string;
  href: (page: number) => string;
}) {
  return (
    <Pager
      page={pagination.page}
      pageCount={pagination.pageCount}
      href={href}
      total={totalLabel}
      words={staffPagerWords(t)}
    />
  );
}
