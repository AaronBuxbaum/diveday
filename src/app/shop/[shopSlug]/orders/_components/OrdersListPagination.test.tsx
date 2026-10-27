// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ImportedOrdersListPagination, OrdersListPagination } from "./OrdersListPagination";

afterEach(cleanup);

it.each(["en-US", "es-ES"])("keeps live and imported paper scopes distinct in %s", (locale) => {
  const t = staffTranslator(locale);
  render(
    <>
      <OrdersListPagination
        t={t}
        shown={20}
        pagination={{ page: 2, pageCount: 3, total: 47 }}
        href={(page) => `/orders?page=${page}`}
      />
      <ImportedOrdersListPagination
        t={t}
        shown={3}
        pagination={{ page: 1, pageCount: 2, total: 23 }}
        href={(page) => `/orders?importedPage=${page}`}
      />
    </>,
  );
  for (const [key, shown, total] of [
    ["orders.index.pagination.paperSubset", 20, 47],
    ["orders.index.importedHistory.pagination.paperSubset", 3, 23],
  ] as const) {
    expect(screen.getByText(t(key, { shown, total }))).toHaveClass("hidden", "print:block");
  }
  for (const pager of screen.getAllByRole("navigation", { name: t("shared.pager.label") })) {
    expect(pager.parentElement).toHaveClass("print:hidden");
  }
  expect(screen.getByRole("link", { name: t("shared.pager.previous") })).toHaveAttribute(
    "href",
    "/orders?page=1",
  );
});
