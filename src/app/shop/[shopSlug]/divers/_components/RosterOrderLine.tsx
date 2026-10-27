import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { DiverFilter, DiverSort } from "@/db/divers";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * The roster's URL for a search, a view and an order: one builder for the
 * sort links, the CSV link and the pager, so none of them drops the others.
 */
export function rosterHref(
  base: string,
  state: { query: string; filter: DiverFilter; sort: DiverSort; page?: number },
): string {
  const search = new URLSearchParams();
  if (state.query) search.set("q", state.query);
  if (state.filter !== "all") search.set("filter", state.filter);
  if (state.sort !== "name") search.set("sort", state.sort);
  if (state.page && state.page > 1) search.set("page", String(state.page));
  return search.size ? `${base}?${search}` : base;
}

/**
 * **"Sort: Name · Last dived"** and **"Download this list (CSV)"** (fourth UX
 * review, item 27): the order a shop calls its lapsed divers in, and the list
 * it calls them from, under whatever view and search are on.
 *
 * The download shows only to a staffer with the people-export permission
 * (`canExportShopData`, owner or manager); the route re-checks it.
 */
export function RosterOrderLine({
  roster,
  query,
  filter,
  sort,
  canDownload,
  t,
}: {
  roster: string;
  query: string;
  filter: DiverFilter;
  sort: DiverSort;
  canDownload: boolean;
  t: StaffTranslator;
}) {
  const link = buttonClass({ variant: "link", size: "sm", flush: true });
  const order = (target: DiverSort, label: string) =>
    target === sort ? (
      <span aria-current="true" className="font-medium text-foreground">
        {label}
      </span>
    ) : (
      <Link
        href={rosterHref(roster, { query, filter, sort: target })}
        scroll={false}
        className={`${link} print:hidden`}
      >
        {label}
      </Link>
    );
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-muted">
      <nav aria-label={t("divers.list.sortAriaLabel")} className="flex items-center gap-2">
        <span>{t("divers.list.sortLabel")}</span>
        {order("name", t("divers.list.sortName"))}
        <span aria-hidden="true" className="print:hidden">
          ·
        </span>
        {order("last_dived", t("divers.list.sortLastDived"))}
      </nav>
      {canDownload ? (
        <a
          href={rosterHref(`${roster}/download`, { query, filter, sort })}
          className={`${link} print:hidden`}
        >
          {t("divers.list.downloadList")}
        </a>
      ) : null}
    </div>
  );
}
