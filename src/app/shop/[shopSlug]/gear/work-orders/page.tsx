import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { AddPanel } from "@/components/AddPanel";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { UndoToast } from "@/components/UndoToast";
import { buttonClass } from "@/components/ui/button";
import { type FilterChip, FilterChips } from "@/components/ui/FilterChips";
import { LedgerGroup, LedgerRow } from "@/components/ui/ledger";
import type { NoticeTone } from "@/components/ui/tone";
import { requireShopSurface } from "@/features/session";
import { listDeletedWorkOrders, workOrderBoard } from "@/features/work-orders";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { addPanelCloseHref, addPanelHref, addPanelOpen } from "@/lib/add-panel";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { noticeFromParam, shopPath } from "@/lib/staff-notices";
import { StaffSectionTabs } from "../../_components/StaffSectionTabs";
import {
  NEW_WORK_ORDER_KEYS,
  NewWorkOrderPanel,
  type NewWorkOrderSearch,
} from "./_components/NewWorkOrderPanel";
import { WorkOrderBoard } from "./_components/WorkOrderBoard";
import { restoreWorkOrderAction } from "./actions";

/** `?notice=` codes this page redirects back to itself with. */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  deleted: { tone: "success", key: "workOrders.notice.deleted" },
  restored: { tone: "success", key: "workOrders.notice.restored" },
  "not-found": { tone: "danger", key: "workOrders.notice.notFound" },
  invalid: { tone: "danger", key: "workOrders.notice.invalid" },
};

export const instant = true;

export const metadata: Metadata = { title: "Work orders — DiveDay" };

/**
 * **The bench** (ADR 20261008-gear-work-orders): every open ticket grouped by
 * status in counter order, the recently collected under them, and one door to
 * open a new one: the bench's own add panel (`?add=1`).
 *
 * It sits beside the register as the Gear section's second tab, because the
 * two are one pillar: a customer's regulator and the shop's own rental
 * regulator run the same clocks and are worked by the same technician.
 *
 * The Deleted chip is the way back from a mistaken delete, and the only one
 * besides the undo toast, which lasts as long as a toast.
 */
export default async function WorkOrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<
    { notice?: string; view?: string; undoId?: string; add?: string } & NewWorkOrderSearch
  >;
}) {
  const { shopSlug } = await params;
  const search = await searchParams;
  const surface = await requireShopSurface(shopSlug);
  const { db, shop, session } = surface;
  // Gear servicing switched off (the Features page): the bench is gone, the
  // register is where Gear opens, and no ticket is deleted.
  if (!shop.workOrdersEnabled) redirect(shopPath(shopSlug, "gear"));
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);

  const [board, deleted] = await Promise.all([
    workOrderBoard(db, shop.id, { todayLocal }),
    listDeletedWorkOrders(db, shop.id),
  ]);
  const total = board.groups.reduce((sum, group) => sum + group.rows.length, 0);
  // A view with nothing in it is not a view, the call the register makes: a
  // hand-typed `?view=deleted` with nothing deleted lands on the bench.
  const showDeleted = deleted.length > 0 && (search.view === "deleted" || total === 0);
  const benchPath = shopPath(shopSlug, "gear", "work-orders");
  // Opening a ticket is the bench's own panel (`?add=1`); what it says about
  // its form, it says beside the form, so the page banner stands down.
  const adding = addPanelOpen(search.add);
  const banner = adding ? null : noticeFromParam(search.notice, NOTICES);
  const newOrderHref = addPanelHref(benchPath);

  const chips: FilterChip[] = [];
  if (deleted.length > 0 && total > 0) {
    chips.push({
      key: "open",
      href: `/shop/${shopSlug}/gear/work-orders`,
      active: !showDeleted,
      label: t("workOrders.title"),
    });
    chips.push({
      key: "deleted",
      href: `/shop/${shopSlug}/gear/work-orders?view=deleted`,
      active: showDeleted,
      label: t("workOrders.board.deletedFilter", { count: deleted.length }),
    });
  }

  return (
    <StaffPage width="full">
      <FlashParams params={["notice", "undoId"]} />
      <ShopPageHeader
        title={t("gear.title")}
        actions={
          total > 0 && !adding ? (
            <Link href={newOrderHref} className={buttonClass()}>
              {t("workOrders.new.door")}
            </Link>
          ) : undefined
        }
      />
      <StaffSectionTabs
        section="gear"
        current="workOrders"
        roles={session.user.roles}
        shop={shop}
        t={t}
      />

      <AddPanel
        open={adding}
        title={t("workOrders.new.title")}
        closeHref={addPanelCloseHref(benchPath, search, NEW_WORK_ORDER_KEYS)}
        closeLabel={t("shared.addPanel.close")}
      >
        <NewWorkOrderPanel
          surface={surface}
          shopSlug={shopSlug}
          board={benchPath}
          search={search}
          t={t}
          locale={locale}
        />
      </AddPanel>

      {search.notice === "deleted" && search.undoId ? (
        <UndoToast
          message={t("workOrders.notice.deleted")}
          action={restoreWorkOrderAction}
          fields={{ workOrderId: search.undoId }}
          pendingLabel={t("words.busy.undoing")}
          undoLabel={t("shared.undoToast.undo")}
          dismissLabel={t("shared.undoToast.dismiss")}
        />
      ) : banner ? (
        <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
      ) : null}

      <section
        aria-label={
          showDeleted ? t("workOrders.board.deletedTitle") : t("workOrders.board.ariaLabel")
        }
      >
        {chips.length > 0 ? <FilterChips label={t("workOrders.title")} chips={chips} /> : null}

        {showDeleted ? (
          <div className="mt-4">
            <LedgerGroup
              as="h2"
              id="work-orders-deleted"
              label={t("workOrders.board.deletedTitle")}
            >
              <ul aria-labelledby="work-orders-deleted">
                {deleted.map((row) => (
                  <LedgerRow
                    key={row.id}
                    trailing={
                      <form action={restoreWorkOrderAction}>
                        <input type="hidden" name="workOrderId" value={row.id} />
                        <SubmitButton
                          pendingLabel={t("words.busy.restoring")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                          ariaLabel={t("workOrders.board.restoreOrder", {
                            name: row.personName ?? row.reportedProblem,
                          })}
                        >
                          {t("workOrders.board.restore")}
                        </SubmitButton>
                      </form>
                    }
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-medium">{row.personName ?? row.reportedProblem}</span>
                      <span className="text-muted text-xs">
                        {t("workOrders.board.deletedOn", {
                          date: formatShortDate(row.deletedAt, locale, shop.timezone),
                        })}
                      </span>
                    </div>
                  </LedgerRow>
                ))}
              </ul>
            </LedgerGroup>
          </div>
        ) : total === 0 ? (
          <EmptyState
            title={t("workOrders.empty.heading")}
            action={
              adding ? undefined : (
                <Link href={newOrderHref} className={buttonClass()}>
                  {t("workOrders.new.door")}
                </Link>
              )
            }
            className="mt-4"
          />
        ) : (
          <WorkOrderBoard
            groups={board.groups}
            shopSlug={shopSlug}
            t={t}
            locale={locale}
            currency={toShopCurrency(shop.currency)}
          />
        )}
      </section>
    </StaffPage>
  );
}
