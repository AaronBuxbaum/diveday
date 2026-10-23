import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { CustomerGearItem } from "@/db/schema";
import type { ServiceReminderState } from "@/db/work-order-follow-up";
import type { DiverWorkOrderRow } from "@/db/work-orders";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { workOrderStatusLabel, workOrderStatusTone } from "@/i18n/work-order-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { shopPath } from "@/lib/staff-notices";
import { isOpenWorkOrderStatus } from "@/lib/work-orders";
import { pieceDueLine } from "../../../gear/work-orders/_components/piece-dates";
import { deleteCustomerGearItemAction } from "../../../gear/work-orders/actions";
import { DiverFileGroupDisclosure } from "./DiverFileGroupDisclosure";
import { DiverFormStatus, type DiverNotice } from "./NoticeBanner";
import { ServiceReminderToggle } from "./ServiceReminderToggle";

/**
 * **The diver's own gear, and what the bench is doing with it** (ADR
 * 20261008-gear-work-orders).
 *
 * A file group like the others: one line of fact — how many pieces of theirs
 * the shop has on record and whether any are on the bench — and the pieces,
 * the tickets and the door to a new one behind it.
 *
 * The pieces live here rather than in "Gear and sizes" because that group
 * answers a different question: what the shop hands *this* diver from its own
 * racks, and in what size. A regulator the diver owns is theirs, it has its
 * own service clock, and it comes back for work whether they ever rent
 * anything or not.
 */
export function WorkOrdersGroup({
  shopSlug,
  personId,
  gear,
  locale,
  timezone,
  t,
  status,
}: {
  shopSlug: string;
  personId: string;
  gear: {
    ownPieces: CustomerGearItem[];
    workOrders: DiverWorkOrderRow[];
    /** Each piece with a due date the reminder pass reads, and its switch. */
    reminders: Map<string, ServiceReminderState>;
    /** Gear servicing is on (the Features page); off, nothing is drawn. */
    workOrdersOffered: boolean;
  };
  locale: string;
  timezone: string;
  t: StaffTranslator;
  /** This group's own outcome, beside the acts that earned it. */
  status?: DiverNotice;
}) {
  if (!gear.workOrdersOffered) return null;
  const { ownPieces: pieces, workOrders: orders, reminders } = gear;
  const open = orders.filter((order) => isOpenWorkOrderStatus(order.status));
  const summary =
    open.length > 0
      ? t("workOrders.diver.onTheBench", { count: open.length })
      : pieces.length > 0
        ? t("workOrders.diver.piecesOnFile", { count: pieces.length })
        : t("workOrders.diver.ordersEmpty");
  const newOrderHref = `${shopPath(shopSlug, "gear", "work-orders", "new")}?personId=${personId}`;

  return (
    <DiverFileGroupDisclosure
      id="work-orders"
      label={t("workOrders.diver.heading")}
      summary={summary}
      // A ticket still on the bench is open work on this record, so the group
      // opens with it, the way a standing can't-fill flag opens its own.
      open={open.length > 0 || Boolean(status)}
      stacked
    >
      {/* Unlabelled shells: the group's row label is its one heading. The
          pieces come first and the tickets under them, each ticket led by its
          number, which is what tells the two lists apart. */}
      <section aria-labelledby="owned-gear-heading" className="space-y-3">
        <h3 id="owned-gear-heading" className="font-medium text-sm text-muted">
          {t("workOrders.diver.gearHeading")}
        </h3>
        <ul className="grid gap-x-8 sm:grid-cols-2">
          {pieces.length === 0 ? (
            <LedgerRow as="li">
              <span className="text-muted">{t("workOrders.diver.gearEmpty")}</span>
            </LedgerRow>
          ) : (
            pieces.map((piece) => (
              <LedgerRow
                as="li"
                key={piece.id}
                trailing={
                  <form action={deleteCustomerGearItemAction}>
                    <input type="hidden" name="customerGearItemId" value={piece.id} />
                    <input type="hidden" name="personId" value={personId} />
                    <input type="hidden" name="returnTo" value="diver" />
                    <SubmitButton
                      pendingLabel={t("workOrders.diver.deletingPiece")}
                      className={buttonClass({ variant: "ghost", size: "sm" })}
                      ariaLabel={t("workOrders.diver.deletePiece", {
                        label: gearItemKindLabel(t, piece.kind),
                      })}
                    >
                      {t("workOrders.diver.deletePieceShort")}
                    </SubmitButton>
                  </form>
                }
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">{gearItemKindLabel(t, piece.kind)}</span>
                  <span className="text-muted text-xs">
                    {[piece.brandModel, piece.serialNumber, ...pieceDueLine(piece, locale, t)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {reminders.has(piece.id) ? (
                    <ServiceReminderToggle
                      customerGearItemId={piece.id}
                      personId={personId}
                      pieceLabel={gearItemKindLabel(t, piece.kind)}
                      state={reminders.get(piece.id) ?? { off: false, lastSentAt: null }}
                      locale={locale}
                      timezone={timezone}
                      t={t}
                    />
                  ) : null}
                </span>
              </LedgerRow>
            ))
          )}
        </ul>
      </section>

      <section aria-labelledby="gear-service-heading" className="mt-8 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="gear-service-heading" className="font-medium text-sm text-muted">
            {t("workOrders.diver.ordersHeading")}
          </h3>
          <Link href={newOrderHref} className={buttonClass({ variant: "secondary", size: "sm" })}>
            {t("workOrders.diver.newOrder")}
          </Link>
        </div>
        <ul>
          {orders.length === 0 ? (
            <LedgerRow as="li">
              <span className="text-muted">{t("workOrders.diver.ordersEmpty")}</span>
            </LedgerRow>
          ) : (
            orders.map((order) => (
              <LedgerRow
                as="li"
                key={order.id}
                href={shopPath(shopSlug, "gear", "work-orders", order.id)}
                linkLabel={t("workOrders.diver.orderLink", {
                  number: order.number,
                  problem: order.reportedProblem,
                })}
                trailing={
                  <Badge tone={workOrderStatusTone(order.status)}>
                    {workOrderStatusLabel(t, order.status)}
                  </Badge>
                }
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium">
                    <span className="text-muted tabular-nums">
                      {t("workOrders.number", { number: order.number })}
                    </span>{" "}
                    {order.reportedProblem}
                  </span>
                  {order.promisedOn ? (
                    <span className="text-muted text-xs">
                      {t("workOrders.board.promised", {
                        date: formatCalendarDate(order.promisedOn, locale),
                      })}
                    </span>
                  ) : null}
                </span>
              </LedgerRow>
            ))
          )}
        </ul>
      </section>

      <DiverFormStatus status={status} className="mt-4" />
    </DiverFileGroupDisclosure>
  );
}
