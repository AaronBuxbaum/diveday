import type { StaffTranslator } from "@/i18n/staff-messages";
import { StaffListPagination } from "../../_components/StaffListPagination";

export function OrdersListPagination({
  t,
  shown,
  pagination,
  href,
  imported = false,
}: {
  t: StaffTranslator;
  shown: number;
  pagination: { page: number; pageCount: number; total: number };
  href: (page: number) => string;
  imported?: boolean;
}) {
  return (
    <StaffListPagination
      t={t}
      scope={{
        key: imported
          ? "orders.index.importedHistory.pagination.paperSubset"
          : "orders.index.pagination.paperSubset",
        shown,
      }}
      pagination={pagination}
      href={href}
    />
  );
}

export function ImportedOrdersListPagination(
  props: Omit<Parameters<typeof OrdersListPagination>[0], "imported">,
) {
  return <OrdersListPagination {...props} imported />;
}
