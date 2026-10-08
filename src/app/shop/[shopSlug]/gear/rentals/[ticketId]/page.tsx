import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { PrintButton } from "@/components/PrintButton";
import { EYEBROW_CLASS, EyebrowBackLink } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { controlClass, Field } from "@/components/ui/form";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getCounterRentalTicket } from "@/db/gear-counter-rentals";
import { gearItemKindLabel, gearPhaseLabel, gearReturnOutcomeLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { reservationPhase } from "@/lib/gear";
import { requireShopSurface } from "@/lib/session";
import { STAFF_DESTINATION_LABEL_KEYS } from "@/lib/staff-destinations";
import { type NoticeTone, noticeFromParam, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { GearReturnPane } from "../../../trips/[id]/prep/_components/GearReturnPane";
import {
  checkOutCounterRentalAction,
  releaseCounterRentalAction,
  returnCounterRentalAction,
} from "../actions";

export const instant = true;

export const metadata: Metadata = {
  title: "Rental ticket — DiveDay",
  robots: { index: false, follow: false },
};

const NOTICES: Record<string, { tone: NoticeTone; key: StaffMessageKey }> = {
  rented: { tone: "success", key: "counterRentals.ticket.notice.rented" },
  "rented-invoiced": { tone: "success", key: "counterRentals.ticket.notice.rentedInvoiced" },
  "rented-not-invoiced": {
    tone: "warning",
    key: "counterRentals.ticket.notice.rentedNotInvoiced",
  },
  "handed-over": { tone: "success", key: "counterRentals.ticket.notice.handedOver" },
  returned: { tone: "success", key: "counterRentals.ticket.notice.returned" },
  "returned-flagged": { tone: "warning", key: "counterRentals.ticket.notice.returnedFlagged" },
  invoiced: { tone: "warning", key: "counterRentals.ticket.notice.invoiced" },
  released: { tone: "success", key: "counterRentals.ticket.notice.released" },
  "not-found": { tone: "warning", key: "counterRentals.ticket.notice.notFound" },
  "concern-needs-words": {
    tone: "warning",
    key: "counterRentals.ticket.notice.concernNeedsWords",
  },
};

/**
 * **A counter rental's ticket** (ADR 20260815-minimal-gear-register, amended
 * 2026-10-08): who has which tagged units and when they are due back, on
 * screen with the acts that move them, and on paper as the slip the person
 * walks off with.
 *
 * The paper keeps the trip slip's deliberate absences: no signature line,
 * because the one shop-wide waiver is the only signed page (CR-015), and no
 * money, because billing lives on the order. The screen links that order, and
 * the link is hidden in print with every act.
 *
 * Ungated beyond staff, like the rest of the register (H-06): handing gear
 * over is day work. Tenancy is the session's shop; another shop's id, or a
 * reservation held by a booking, is a 404.
 */
export default async function CounterRentalTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; ticketId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug, ticketId: rawTicketId } = await params;
  const { notice } = await searchParams;
  // An unparseable literal raises in Postgres rather than missing; narrow it
  // first so a mistyped URL is this page's 404, not a 500.
  const ticketId = uuidParam(rawTicketId);
  if (!ticketId) notFound();

  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const ticket = await getCounterRentalTicket(db, shop.id, ticketId);
  if (!ticket) notFound();

  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);
  const banner = noticeFromParam(notice, NOTICES);
  const onWall = ticket.units.filter((unit) => !unit.checkedOutAt && !unit.returnedAt);
  const out = ticket.units.filter((unit) => unit.checkedOutAt && !unit.returnedAt);
  const window =
    ticket.reservedFrom === ticket.reservedUntil
      ? formatCalendarDate(ticket.reservedFrom, locale)
      : `${formatCalendarDate(ticket.reservedFrom, locale)} – ${formatCalendarDate(ticket.reservedUntil, locale)}`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <div id="rental-ticket">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
          <div>
            <EyebrowBackLink href={shopPath(shopSlug, "gear")} className="print:hidden">
              {t(STAFF_DESTINATION_LABEL_KEYS.gear)}
            </EyebrowBackLink>
            <p className={`hidden ${EYEBROW_CLASS} print:block`}>{t("gear.ticket.eyebrow")}</p>
            <h1 className={`mt-1 ${SHELL_TITLE_CLASS}`}>{ticket.personName}</h1>
            <p className="mt-1 text-muted">{window}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3 print:hidden">
            {ticket.orderId ? (
              <Link
                href={shopPath(shopSlug, "orders", ticket.orderId)}
                className={buttonClass({ variant: "secondary" })}
              >
                {t("counterRentals.ticket.order")}
              </Link>
            ) : null}
            <PrintButton label={t("shared.printButton.label")} />
          </div>
        </header>

        {banner ? (
          <div className="print:hidden">
            <StaffNoticeBanner tone={banner.tone}>{t(banner.key)}</StaffNoticeBanner>
          </div>
        ) : null}

        <section aria-labelledby="ticket-units-heading" className="mt-8">
          <h2 id="ticket-units-heading" className={SECTION_TITLE_CLASS}>
            {t("gear.ticket.unitsHeading")}
          </h2>
          {/* One column for the tags, so every kind starts at one x — the
              trip slip's subgrid (K-505), with a third column on screen for
              where each unit stands. */}
          <ul
            className={sectionCardClass({
              padding: "none",
              className:
                "mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 divide-y divide-border overflow-hidden sm:grid-cols-[max-content_minmax(0,1fr)_max-content]",
            })}
          >
            {ticket.units.map((unit) => (
              <li
                key={unit.reservationId}
                className="col-span-2 grid grid-cols-subgrid items-baseline gap-y-1 px-4 py-3 sm:col-span-3 sm:px-5"
              >
                <span className="font-mono text-lg font-medium">{unit.label}</span>
                <span className="text-muted">
                  {gearItemKindLabel(t, unit.kind)}
                  {unit.size ? ` · ${unit.size}` : ""}
                </span>
                <span className="col-start-2 text-sm text-muted sm:col-start-auto print:hidden">
                  {gearPhaseLabel(
                    t,
                    reservationPhase({ ...unit, reservedUntil: ticket.reservedUntil }, todayLocal),
                  )}
                  {unit.returnOutcome ? ` · ${gearReturnOutcomeLabel(t, unit.returnOutcome)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {onWall.length > 0 || out.length > 0 ? (
          <section className="mt-6 flex flex-col gap-4 print:hidden">
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
                  noteLabel: t("gear.prep.returnNoteLabel"),
                  notePlaceholder: t("gear.prep.returnNotePlaceholder"),
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
          </section>
        ) : null}

        <p className="mt-6 text-lg">
          {t("gear.ticket.dueBack", { date: formatCalendarDate(ticket.reservedUntil, locale) })}
        </p>
        {/* Who to call when it breaks, or when it will be late — the slip is
            the one page the person carries away. */}
        <p className="mt-8 border-t border-border pt-4 text-sm text-muted">
          {shop.name}
          {shop.contactPhone ? ` · ${shop.contactPhone}` : ""}
        </p>
      </div>
    </main>
  );
}
