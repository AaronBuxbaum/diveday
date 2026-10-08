import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { EyebrowBackLink } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { LedgerRow } from "@/components/ui/ledger";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { latestServiceClocks } from "@/db/gear";
import { listStaff } from "@/db/trips-crew";
import { getWorkOrderDetail } from "@/db/work-orders";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel, workOrderStatusTone } from "@/i18n/work-order-labels";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { toShopCurrency } from "@/lib/money";
import { requireShopSurface } from "@/lib/session";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import type { WorkOrderOutcome } from "@/lib/work-orders";
import { BillAndPickupCard } from "../_components/BillAndPickupCard";
import { pieceDueLine } from "../_components/piece-dates";
import { WorkOrderHistoryCard } from "../_components/WorkOrderHistoryCard";
import { WorkOrderJobCard } from "../_components/WorkOrderJobCard";
import { WorkOrderLinesCard } from "../_components/WorkOrderLinesCard";
import { WorkOrderStatusCard } from "../_components/WorkOrderStatusCard";
import { WorkOrderWorkCard } from "../_components/WorkOrderWorkCard";
import { deleteWorkOrderAction } from "../actions";

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  opened: { tone: "success", key: "workOrders.notice.opened" },
  moved: { tone: "success", key: "workOrders.notice.moved" },
  saved: { tone: "success", key: "workOrders.notice.saved" },
  "work-recorded": { tone: "success", key: "workOrders.notice.workRecorded" },
  "line-added": { tone: "success", key: "workOrders.notice.lineAdded" },
  "line-saved": { tone: "success", key: "workOrders.notice.lineSaved" },
  "line-deleted": { tone: "success", key: "workOrders.notice.lineDeleted" },
  restored: { tone: "success", key: "workOrders.notice.restored" },
  already: { tone: "warning", key: "workOrders.notice.already" },
  closed: { tone: "warning", key: "workOrders.notice.closed" },
  "already-recorded": { tone: "warning", key: "workOrders.notice.alreadyRecorded" },
  "invalid-quantity": { tone: "danger", key: "workOrders.notice.invalidQuantity" },
  "invalid-amount": { tone: "danger", key: "workOrders.notice.invalidAmount" },
  "empty-description": { tone: "danger", key: "workOrders.notice.emptyDescription" },
  "empty-problem": { tone: "danger", key: "workOrders.notice.emptyProblem" },
  "invalid-date": { tone: "danger", key: "workOrders.notice.invalidDate" },
  "unknown-technician": { tone: "danger", key: "workOrders.notice.unknownTechnician" },
  "no-outcome": { tone: "danger", key: "workOrders.notice.noOutcome" },
  "no-care": { tone: "danger", key: "workOrders.notice.noCare" },
  "care-on-not-done": { tone: "danger", key: "workOrders.notice.invalidCare" },
  "invalid-care": { tone: "danger", key: "workOrders.notice.invalidCare" },
  "note-required": { tone: "danger", key: "workOrders.notice.noteRequired" },
  "future-date": { tone: "danger", key: "workOrders.notice.futureDate" },
  "due-not-after-performed": { tone: "danger", key: "workOrders.notice.dueNotAfterPerformed" },
  "invalid-dives": { tone: "danger", key: "workOrders.notice.invalidDives" },
  "not-found": { tone: "danger", key: "workOrders.notice.notFound" },
  invalid: { tone: "danger", key: "workOrders.notice.invalid" },
};

export const instant = true;

export const metadata: Metadata = { title: "Work order — DiveDay" };

/**
 * **One ticket, whole** (ADR 20261008-gear-work-orders): where it goes next,
 * the job, the gear, the Work done record, what it comes to, and how it got
 * here.
 *
 * A deleted ticket's own record stays readable, read-only, with Restore where
 * the acts were — the rule a unit's record set (ADR 20260823's amendment to
 * 20260815-minimal-gear-register), and for the same reason: the shop may still
 * be asked what happened to that regulator.
 */
export default async function WorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; workOrderId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug, workOrderId: rawId } = await params;
  const { notice } = await searchParams;
  // A caller-controlled uuid, narrowed before the read: an unparseable literal
  // raises in Postgres rather than missing.
  const workOrderId = uuidParam(rawId);
  if (!workOrderId) notFound();

  const { db, shop, session } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const currency = toShopCurrency(shop.currency);

  const [detail, staff] = await Promise.all([
    getWorkOrderDetail(db, shop.id, workOrderId, { todayLocal }),
    listStaff(db, shop.id),
  ]);
  if (!detail) notFound();
  const { workOrder } = detail;
  // A shop unit's last reading of each clock, so the Work done form can carry
  // the fleet's own interval forward instead of a convention.
  const clocks = workOrder.gearItemId
    ? ((await latestServiceClocks(db, shop.id, [workOrder.gearItemId])).get(workOrder.gearItemId) ??
      [])
    : [];
  const deleted = workOrder.deletedAt !== null;
  const outcome = workOrder.outcome as WorkOrderOutcome | null;
  const banner = noticeFromParam(notice, NOTICES);
  const board = shopPath(shopSlug, "gear", "work-orders");
  const subject = detail.personName ?? detail.gearItemLabel ?? t("workOrders.title");

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <EyebrowBackLink href={board}>{t("workOrders.title")}</EyebrowBackLink>
          <h1 className={`mt-1 ${SHELL_TITLE_CLASS}`}>{subject}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted">
            <span className="font-medium text-foreground tabular-nums">
              {t("workOrders.number", { number: workOrder.number })}
            </span>
            {deleted ? <Badge tone="neutral">{t("workOrders.detail.deletedBadge")}</Badge> : null}
            <Badge tone={workOrderStatusTone(workOrder.status)}>
              {workOrderStatusLabel(t, workOrder.status, detail.subject, outcome)}
            </Badge>
            {detail.late ? <Badge tone="warning">{t("workOrders.board.late")}</Badge> : null}
            <span className="text-sm">
              {[
                t("workOrders.detail.receivedOn", {
                  date: formatShortDate(workOrder.receivedAt, locale, shop.timezone),
                }),
                detail.technicianName
                  ? t("workOrders.board.with", { name: detail.technicianName })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
        </div>
        {deleted ? null : (
          <Link
            href={`${board}/${workOrder.id}/tag`}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("workOrders.detail.claimTag")}
          </Link>
        )}
      </header>

      {banner ? <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner> : null}

      <div className="mt-8 space-y-10">
        {detail.gearItemKind ? (
          <p className="text-muted">
            {t("workOrders.detail.ownUnitSubject", {
              kind: gearItemKindLabel(t, detail.gearItemKind),
            })}
          </p>
        ) : null}

        <WorkOrderStatusCard
          workOrder={workOrder}
          subject={detail.subject}
          readOnly={deleted}
          t={t}
        />

        <WorkOrderJobCard
          workOrder={workOrder}
          unit={detail.subject === "unit"}
          staff={staff}
          technicianName={detail.technicianName}
          readOnly={deleted}
          locale={locale}
          t={t}
        />

        {detail.pieces.length > 0 ? (
          <SectionCard title={t("workOrders.detail.piecesHeading")} padding="lg">
            <ul>
              {detail.pieces.map((piece) => (
                <LedgerRow key={piece.id}>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{gearItemKindLabel(t, piece.kind)}</span>
                    <span className="text-muted text-xs">
                      {[piece.brandModel, piece.serialNumber, ...pieceDueLine(piece, locale, t)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </LedgerRow>
              ))}
            </ul>
          </SectionCard>
        ) : null}

        <WorkOrderWorkCard
          detail={detail}
          previousClocks={clocks}
          todayLocal={todayLocal}
          locale={locale}
          t={t}
        />

        <WorkOrderLinesCard
          workOrderId={workOrder.id}
          lines={detail.lines}
          totalCents={detail.totalCents}
          readOnly={deleted}
          currency={currency}
          locale={locale}
          t={t}
        />
        <BillAndPickupCard
          db={db}
          shop={shop}
          workOrder={workOrder}
          lineCount={detail.lines.length}
          totalCents={detail.totalCents}
          viewerPersonId={session.user.personId}
          notice={notice}
          locale={locale}
          t={t}
        />
        <WorkOrderHistoryCard
          events={detail.events}
          subject={detail.subject}
          outcome={outcome}
          locale={locale}
          timezone={shop.timezone}
          t={t}
        />

        {deleted ? null : (
          <form action={deleteWorkOrderAction}>
            <input type="hidden" name="workOrderId" value={workOrder.id} />
            <SubmitButton
              pendingLabel={t("workOrders.detail.deleting")}
              className={buttonClass({ variant: "ghost" })}
            >
              {t("workOrders.detail.delete")}
            </SubmitButton>
          </form>
        )}
      </div>
    </main>
  );
}
