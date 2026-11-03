import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import type { NoticeTone } from "@/components/ui/tone";
import { getCounterRentalTicketPage } from "@/db/counter-rental-ticket-page";
import {
  gearItemKindLabel,
  gearPhaseLabel,
  gearReturnOutcomeLabel,
  tankFillLabel,
} from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { reservationPhase } from "@/lib/gear";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { noticeCountParam, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SheetDocument } from "../../../print/_components/SheetDocument";
import { sheetPrinted } from "../../../print/_components/ShopSheet";
import { GearReturnPane } from "../../../trips/[id]/prep/_components/GearReturnPane";
import { CounterRentalWaiverLine } from "../../_components/CounterRentalWaiverLine";
import { RentalSlip } from "../../_components/RentalSlip";
import {
  checkOutCounterRentalAction,
  releaseCounterRentalAction,
  returnCounterRentalAction,
} from "../actions";
import { payableInvoiceUrl, RentalTicketPayment } from "./_components/RentalTicketPayment";
import { TankGas, TankGasCorrections } from "./_components/TankGas";

export const instant = true;

export const metadata: Metadata = {
  title: "Rental ticket — DiveDay",
  robots: { index: false, follow: false },
};

/** `counted`: the sentence names `?count=`, and without a readable one says nothing. */
const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey; counted?: true }> = {
  rented: { tone: "success", key: "counterRentals.ticket.notice.rented" },
  "rented-invoiced": { tone: "success", key: "counterRentals.ticket.notice.rentedInvoiced" },
  "rented-paid": { tone: "success", key: "counterRentals.ticket.notice.rentedPaid" },
  "rented-not-recorded": {
    tone: "warning",
    key: "counterRentals.ticket.notice.rentedNotRecorded",
  },
  "rented-not-invoiced": {
    tone: "warning",
    key: "counterRentals.ticket.notice.rentedNotInvoiced",
  },
  "handed-over": { tone: "success", key: "counterRentals.ticket.notice.handedOver" },
  returned: { tone: "success", key: "counterRentals.ticket.notice.returned" },
  "returned-flagged": { tone: "warning", key: "counterRentals.ticket.notice.returnedFlagged" },
  "returned-pulled": {
    tone: "success",
    key: "counterRentals.ticket.notice.returnedPulled",
    counted: true,
  },
  invoiced: { tone: "warning", key: "counterRentals.ticket.notice.invoiced" },
  released: { tone: "success", key: "counterRentals.ticket.notice.released" },
  "not-found": { tone: "warning", key: "counterRentals.ticket.notice.notFound" },
  "fill-corrected": { tone: "success", key: "counterRentals.ticket.notice.fillCorrected" },
  "fill-invalid": { tone: "warning", key: "counterRentals.new.notice.fillInvalid" },
  "fill-not-tank": { tone: "warning", key: "counterRentals.ticket.notice.fillRefused" },
  "no-nitrox-card": { tone: "warning", key: "counterRentals.new.notice.noNitroxCard" },
  "concern-needs-words": {
    tone: "warning",
    key: "counterRentals.ticket.notice.concernNeedsWords",
  },
};

/**
 * **A counter rental's ticket** (ADR 20260815-minimal-gear-register, amended
 * 2026-10-08): who has which tagged units and when they are due back. The slip
 * the person walks off with is one sheet of the shop's paper (`RentalSlip`,
 * issue #2745), and the acts that move the rental sit above it on the screen
 * alone (`SheetDocument`'s `screen`), so what the counter reviews is what
 * prints. The slip's foot is the shared `RentalTicketReceipt`, which owns the
 * terms, signature and gear-receipt-not-waiver contract (CR-015).
 *
 * Unlike the trip slip it carries live rental operations, and what was charged
 * is read from the linked order, on screen and on paper: lines, total, paid or
 * not, with a code to pay an open invoice on the spot (Aaron, 2026-10-09).
 *
 * Ungated beyond staff, like the rest of the register (H-20260724-initial-gear-policy-sizing). Tenancy is the
 * session's shop; another shop's id, or a reservation held by a booking, is a
 * 404.
 */
export default async function CounterRentalTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; ticketId: string }>;
  searchParams: Promise<{ notice?: string; count?: string }>;
}) {
  const { shopSlug, ticketId: rawTicketId } = await params;
  const { notice, count } = await searchParams;
  // An unparseable literal raises in Postgres rather than missing; narrow it
  // first so a mistyped URL is this page's 404, not a 500.
  const ticketId = uuidParam(rawTicketId);
  if (!ticketId) notFound();

  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const page = await getCounterRentalTicketPage(db, shop, ticketId);
  if (!page) notFound();
  const { ticket, billing, waivers } = page;

  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const noticeCount = noticeCountParam(count);
  const found = noticeFromParam(notice, NOTICES);
  const banner = found && (!found.counted || noticeCount !== null) ? found : undefined;
  const onWall = ticket.units.filter((unit) => !unit.checkedOutAt && !unit.returnedAt);
  const out = ticket.units.filter((unit) => unit.checkedOutAt && !unit.returnedAt);
  const window =
    ticket.reservedFrom === ticket.reservedUntil
      ? formatCalendarDate(ticket.reservedFrom, locale)
      : `${formatCalendarDate(ticket.reservedFrom, locale)} – ${formatCalendarDate(ticket.reservedUntil, locale)}`;

  const payable = billing ? payableInvoiceUrl(billing.order) : null;
  const gearHref = shopPath(shopSlug, "gear");

  return (
    <SheetDocument
      backHref={gearHref}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t(STAFF_DESTINATION_LABEL_KEYS.gear)}
      printLabel={t("print.sheet.door")}
      // Reached from Rent out and the register's Rentals view, never from a
      // Print: the counter works the rental here first.
      autoPrint={false}
      doors={
        <>
          {ticket.orderId ? (
            <Link
              href={shopPath(shopSlug, "orders", ticket.orderId)}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("counterRentals.ticket.order")}
            </Link>
          ) : null}
          {payable ? (
            <a
              href={payable}
              target="_blank"
              rel="noreferrer"
              className={buttonClass({ variant: "secondary" })}
            >
              {t("counterRentals.ticket.payment.open")}
            </a>
          ) : null}
        </>
      }
      screen={
        <>
          <FlashParams params={["notice", "count"]} />
          {banner ? (
            <StaffNoticeBanner tone={banner.tone}>
              {t(banner.key, { count: noticeCount ?? 0 })}
            </StaffNoticeBanner>
          ) : null}
          {/* **The person's waiver, informing only** (issue #2261, H-20261008-counter-rental-waiver-informs).
              On the screen above the slip, never on it: the slip the person
              carries away is a receipt for gear, not a note about them. */}
          <CounterRentalWaiverLine
            t={t}
            status={waivers.get(ticket.personId)}
            personId={ticket.personId}
            ticketId={ticket.ticketId}
            shopSlug={shopSlug}
            locale={locale}
            timezone={shop.timezone}
          />
          {/* Where each unit stands, which the slip never says. */}
          <ul
            className={sectionCardClass({
              padding: "none",
              className:
                "grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 divide-y divide-border overflow-hidden",
            })}
          >
            {ticket.units.map((unit) => (
              <li
                key={unit.reservationId}
                className="col-span-2 grid grid-cols-subgrid items-baseline px-4 py-3 sm:px-5"
              >
                <span className="font-mono font-medium">{unit.label}</span>
                <span className="text-sm text-muted">
                  {gearPhaseLabel(
                    t,
                    reservationPhase({ ...unit, reservedUntil: ticket.reservedUntil }, todayLocal),
                  )}
                  {unit.returnOutcome ? ` · ${gearReturnOutcomeLabel(t, unit.returnOutcome)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <TankGasCorrections t={t} ticketId={ticket.ticketId} units={ticket.units} />
          {onWall.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <form action={checkOutCounterRentalAction}>
                <input type="hidden" name="ticketId" value={ticket.ticketId} />
                <SubmitButton pendingLabel={t("gear.prep.handingOver")} className={buttonClass()}>
                  {t("gear.prep.handOver")}
                </SubmitButton>
              </form>
              <form action={releaseCounterRentalAction}>
                <input type="hidden" name="ticketId" value={ticket.ticketId} />
                <SubmitButton
                  pendingLabel={t("gear.unit.where.releasing")}
                  className={buttonClass({ variant: "ghost" })}
                >
                  {t("gear.unit.where.release")}
                </SubmitButton>
              </form>
            </div>
          ) : null}
          {out.length > 0 ? (
            <GearReturnPane
              fields={{ ticketId: ticket.ticketId }}
              action={returnCounterRentalAction}
              labels={{
                allGood: t("gear.prep.returnAllGood"),
                fitAdjusted: t("gear.prep.returnFitAdjusted"),
                serviceConcern: t("gear.prep.returnServiceConcern"),
                cancelConcern: t("gear.prep.returnCancelConcern"),
                noteLabel: t("gear.prep.returnNoteLabel"),
                notePlaceholder: t("gear.prep.returnNotePlaceholder"),
              }}
              bench={{
                legend: t("gear.prep.returnPullToBench"),
                units: out.map((unit) => ({ id: unit.gearItemId, label: unit.label })),
              }}
            >
              {/* Optional, and the only count the dive clock gets for a
                  counter rental: blank counts nothing (ADR
                  20260815-minimal-gear-register, amendment 2026-10-08). */}
              <Field label={t("counterRentals.ticket.divesLabel")} className="max-w-48">
                <input
                  type="number"
                  name="dives"
                  min={0}
                  max={200}
                  step={1}
                  inputMode="numeric"
                  className={controlClass}
                />
              </Field>
            </GearReturnPane>
          ) : null}
        </>
      }
    >
      <RentalSlip
        shop={shop}
        shopSlug={shopSlug}
        printed={sheetPrinted(t, nowDate(), locale, shop.timezone)}
        holder={ticket.personName}
        line={window}
        units={ticket.units.map((unit) => ({
          id: unit.reservationId,
          label: unit.label,
          detail: [
            gearItemKindLabel(t, unit.kind),
            unit.size,
            // The recorded gas prints on the ticket (#2257).
            unit.fillO2Percent !== null ? tankFillLabel(t, unit.fillO2Percent) : null,
          ]
            .filter(Boolean)
            .join(" · "),
        }))}
        dueBack={t("gear.ticket.dueBack", {
          date: formatCalendarDate(ticket.reservedUntil, locale),
        })}
        terms={shop.rentalTerms}
        t={t}
        // Who to call when it breaks, or when it will be late: the slip is the
        // one page the person carries away.
        foot={shop.contactPhone}
      >
        <TankGas t={t} units={ticket.units} />
        {billing ? (
          <RentalTicketPayment
            order={billing.order}
            lineItems={billing.lineItems}
            locale={locale}
            t={t}
          />
        ) : null}
      </RentalSlip>
    </SheetDocument>
  );
}
