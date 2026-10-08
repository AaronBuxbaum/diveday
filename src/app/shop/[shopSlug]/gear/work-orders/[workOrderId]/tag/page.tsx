import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { EYEBROW_CLASS, EyebrowBackLink } from "@/components/ShopPageHeader";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { getWorkOrderDetail } from "@/db/work-orders";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

export const instant = true;

export const metadata: Metadata = { title: "Claim tag — DiveDay" };

/**
 * **The claim tag** (ADR 20261008-gear-work-orders): the half-sheet the
 * counter prints when a regulator is handed over the counter, and the diver
 * walks away with.
 *
 * It follows the rental slip (`trips/[id]/prep/ticket/[bookingId]`) in what it
 * is *not*. Not a waiver: no signature line and nothing to agree to. Not a
 * quote or a receipt: the parts and labor on the ticket are the shop's working
 * figures until the job is done, and a printed total on the way in is a price
 * promise nobody made. What is left is the only thing a claim tag is for —
 * *what we have, what you told us, and when to come back* — which is why the
 * page is a list of pieces, one sentence and one date.
 */
export default async function ClaimTagPage({
  params,
}: {
  params: Promise<{ shopSlug: string; workOrderId: string }>;
}) {
  const { shopSlug, workOrderId: rawId } = await params;
  // A caller-controlled uuid, narrowed before the read: an unparseable literal
  // raises in Postgres rather than missing.
  const workOrderId = uuidParam(rawId);
  if (!workOrderId) notFound();

  const { db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);

  // Tenancy is the session's shop, never the slug: another shop's ticket
  // resolves to nothing here rather than printing their diver on this paper.
  const detail = await getWorkOrderDetail(db, shop.id, workOrderId, { todayLocal });
  if (!detail) notFound();
  // A deleted ticket has no tag: the record stays readable on its own page,
  // but nothing goes on paper for a job the shop has taken back off the bench.
  if (detail.workOrder.deletedAt !== null) notFound();

  const order = shopPath(shopSlug, "gear", "work-orders", workOrderId);
  const subject = detail.personName ?? detail.gearItemLabel ?? t("workOrders.tag.eyebrow");

  return (
    <div id="work-order-tag">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          {/* On screen the eyebrow is the way back to the ticket the counter
              tapped in from; on paper it is the tag's own name instead, because
              the sheet a diver walks off with has to say what it is and has no
              navigation. */}
          <EyebrowBackLink href={order} className="print:hidden">
            {t("workOrders.detail.eyebrow")}
          </EyebrowBackLink>
          <p className={`hidden ${EYEBROW_CLASS} print:block`}>{t("workOrders.tag.eyebrow")}</p>
          <h1 className={`mt-1 ${SHELL_TITLE_CLASS}`}>{subject}</h1>
          <p className="mt-1 text-muted">
            {t("workOrders.detail.receivedOn", {
              date: formatShortDate(detail.workOrder.receivedAt, locale, shop.timezone),
            })}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 print:hidden">
          <PrintButton label={t("shared.printButton.label")} />
        </div>
      </header>

      <section aria-labelledby="claim-tag-pieces-heading" className="mt-8">
        <h2 id="claim-tag-pieces-heading" className={SECTION_TITLE_CLASS}>
          {t("workOrders.tag.piecesHeading")}
        </h2>
        <ul
          className={sectionCardClass({
            padding: "none",
            className:
              "mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 divide-y divide-border overflow-hidden",
          })}
        >
          {detail.pieces.length > 0 ? (
            detail.pieces.map((piece) => (
              <li
                key={piece.id}
                className="col-span-2 grid grid-cols-subgrid items-baseline px-4 py-3 sm:px-5"
              >
                <span className="font-medium text-lg">{gearItemKindLabel(t, piece.kind)}</span>
                <span className="text-muted">
                  {[piece.brandModel, piece.serialNumber].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))
          ) : (
            <li className="col-span-2 grid grid-cols-subgrid items-baseline px-4 py-3 sm:px-5">
              <span className="font-medium font-mono text-lg">{detail.gearItemLabel}</span>
              <span className="text-muted">
                {detail.gearItemKind ? gearItemKindLabel(t, detail.gearItemKind) : ""}
              </span>
            </li>
          )}
        </ul>
      </section>

      <section aria-labelledby="claim-tag-problem-heading" className="mt-8">
        <h2 id="claim-tag-problem-heading" className={SECTION_TITLE_CLASS}>
          {t("workOrders.tag.problemHeading")}
        </h2>
        <p className="mt-3 whitespace-pre-line">{detail.workOrder.reportedProblem}</p>
      </section>

      {detail.workOrder.promisedOn ? (
        <p className="mt-6 text-lg">
          {t("workOrders.tag.promised", {
            date: formatCalendarDate(detail.workOrder.promisedOn, locale),
          })}
        </p>
      ) : null}
      <p className="mt-8 border-t border-border pt-4 text-muted text-sm">{shop.name}</p>
    </div>
  );
}
