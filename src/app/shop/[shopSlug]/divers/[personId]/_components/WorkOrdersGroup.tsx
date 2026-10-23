import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { InsetGroup } from "@/components/ui/ledger";
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
 * A file group like the others: one line of fact — the pieces of theirs the
 * shop has on record, or how many are on the bench — and behind it one card
 * of pieces, each with its own tickets beneath it.
 *
 * **One list, filed by piece** (Aaron, 2026-10-23: "very ugly and
 * confusing"). It was two loose lists under two small headings: the pieces in
 * a two-column grid whose rules broke at the gutter, and every ticket in a
 * second list below with nothing saying which regulator "Inflator sticks
 * open" was about. Now a ticket sits under the piece it is for, in the same
 * hairline card the certifications use, and the door to a new ticket is the
 * card's last row the way "Add certification" is.
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
  // The pieces by name, the way the certifications row lists the cards: what
  // a staffer wants off a closed door is what they own, not a count of it.
  const kinds = pieces.map((piece) => gearItemKindLabel(t, piece.kind));
  const summary =
    open.length > 0
      ? t("workOrders.diver.onTheBench", { count: open.length })
      : kinds.length > 0
        ? kinds.join(" · ")
        : t("workOrders.diver.gearEmpty");
  const newOrderHref = `${shopPath(shopSlug, "gear", "work-orders", "new")}?personId=${personId}`;
  const pieceIds = new Set(pieces.map((piece) => piece.id));
  // A ticket whose pieces have all been deleted still belongs on the record.
  const unfiled = orders.filter((order) => !order.pieceIds.some((id) => pieceIds.has(id)));

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
      <InsetGroup bodyAs="ul">
        {pieces.length === 0 && unfiled.length === 0 ? (
          <li className="px-5 py-4 text-sm text-muted sm:px-6">
            {t("workOrders.diver.gearEmpty")}
          </li>
        ) : null}
        {pieces.map((piece) => {
          const kind = gearItemKindLabel(t, piece.kind);
          const facts = [
            piece.serialNumber
              ? t("workOrders.diver.serial", { serial: piece.serialNumber })
              : null,
            ...pieceDueLine(piece, locale, t),
          ].filter(Boolean);
          const tickets = orders.filter((order) => order.pieceIds.includes(piece.id));
          return (
            <li key={piece.id} className="px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {kind}
                    {piece.brandModel ? (
                      <span className="font-normal text-muted"> · {piece.brandModel}</span>
                    ) : null}
                  </p>
                  {facts.length > 0 ? (
                    <p className="mt-1 break-words text-sm text-muted">{facts.join(" · ")}</p>
                  ) : null}
                </div>
                <form action={deleteCustomerGearItemAction} className="shrink-0">
                  <input type="hidden" name="customerGearItemId" value={piece.id} />
                  <input type="hidden" name="personId" value={personId} />
                  <input type="hidden" name="returnTo" value="diver" />
                  <SubmitButton
                    pendingLabel={t("workOrders.diver.deletingPiece")}
                    className={buttonClass({ variant: "danger-ghost", size: "sm" })}
                    ariaLabel={t("workOrders.diver.deletePiece", { label: kind })}
                  >
                    {t("workOrders.diver.deletePieceShort")}
                  </SubmitButton>
                </form>
              </div>
              {reminders.has(piece.id) ? (
                <ServiceReminderToggle
                  customerGearItemId={piece.id}
                  personId={personId}
                  pieceLabel={kind}
                  state={reminders.get(piece.id) ?? { off: false, lastSentAt: null }}
                  locale={locale}
                  timezone={timezone}
                  t={t}
                />
              ) : null}
              <TicketList
                orders={tickets}
                shopSlug={shopSlug}
                locale={locale}
                t={t}
                className="mt-3"
              />
            </li>
          );
        })}
        {unfiled.length > 0 ? (
          <li className="px-5 py-4 sm:px-6">
            <TicketList orders={unfiled} shopSlug={shopSlug} locale={locale} t={t} />
          </li>
        ) : null}
        <li className="px-5 py-3 sm:px-6">
          <Link
            href={newOrderHref}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("workOrders.diver.newOrder")}
          </Link>
        </li>
      </InsetGroup>

      <DiverFormStatus status={status} className="mt-4" />
    </DiverFileGroupDisclosure>
  );
}

/** A piece's tickets, each a door to its work order with its state beside it. */
function TicketList({
  orders,
  shopSlug,
  locale,
  t,
  className = "",
}: {
  orders: DiverWorkOrderRow[];
  shopSlug: string;
  locale: string;
  t: StaffTranslator;
  className?: string;
}) {
  if (orders.length === 0) return null;
  return (
    <ul className={`space-y-2 ${className}`}>
      {orders.map((order) => (
        <li key={order.id}>
          <Link
            href={shopPath(shopSlug, "gear", "work-orders", order.id)}
            aria-label={t("workOrders.diver.orderLink", {
              number: order.number,
              problem: order.reportedProblem,
            })}
            className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-sunken"
          >
            <span className="min-w-0">
              <span className="text-muted tabular-nums">
                {t("workOrders.number", { number: order.number })}
              </span>{" "}
              {order.reportedProblem}
              {order.promisedOn ? (
                <span className="text-muted">
                  {" · "}
                  {t("workOrders.board.promised", {
                    date: formatCalendarDate(order.promisedOn, locale),
                  })}
                </span>
              ) : null}
            </span>
            <Badge tone={workOrderStatusTone(order.status)}>
              {workOrderStatusLabel(t, order.status)}
            </Badge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
