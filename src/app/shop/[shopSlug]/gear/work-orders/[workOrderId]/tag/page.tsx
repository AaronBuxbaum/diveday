import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getWorkOrderDetail } from "@/db/work-orders";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone, formatCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { PACKET_PAPER } from "@/lib/print-sheets";
import { requireShopSurface } from "@/lib/session";
import { shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";
import { SheetDocument } from "../../../../print/_components/SheetDocument";
import { ShopSheet, sheetPrinted } from "../../../../print/_components/ShopSheet";
import { ClaimTag } from "./_components/ClaimTag";

export const instant = true;

export const metadata: Metadata = { title: "Claim tag — DiveDay" };

/**
 * **The claim tag** (ADR 20261008-gear-work-orders): the half-sheet the
 * counter prints when a regulator is handed over the counter, and the diver
 * walks away with.
 *
 * It follows the rental slip (`trips/[id]/prep?diver=`) in what it
 * is *not*. Not a waiver: no signature line and nothing to agree to. Not a
 * quote or a receipt: the parts and labor on the ticket are the shop's working
 * figures until the job is done, and a printed total on the way in is a price
 * promise nobody made. What is left is the only thing a claim tag is for —
 * *what we have, what you told us, and when to come back* — which is why the
 * page is a list of pieces, one sentence and one date, under the ticket's
 * number, with the shop's phone at the foot for the call that asks after it.
 *
 * One sheet of the shop's paper (issue #2745), the same on screen as on paper:
 * the way back and Print sit above it, and `AutoPrint` opens the dialog,
 * because the ticket's door said "Print claim tag".
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
  // Gear servicing switched off (the Features page): the bench is gone, the
  // register is where Gear opens, and no ticket is deleted.
  if (!shop.workOrdersEnabled) redirect(shopPath(shopSlug, "gear"));
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

  const subject = detail.personName ?? detail.gearItemLabel ?? t("workOrders.tag.eyebrow");

  return (
    <SheetDocument
      backHref={shopPath(shopSlug, "gear", "work-orders", workOrderId)}
      paper={PACKET_PAPER}
      brandDisplayFont={shop.brandDisplayFont}
      backLabel={t("workOrders.detail.eyebrow")}
      printLabel={t("print.sheet.door")}
    >
      <ShopSheet
        paper={PACKET_PAPER}
        shop={shop}
        shopSlug={shopSlug}
        name={t("workOrders.tag.eyebrow")}
        printed={sheetPrinted(t, nowDate(), locale, shop.timezone)}
      >
        <ClaimTag
          t={t}
          subject={subject}
          number={detail.workOrder.number}
          receivedOn={formatShortDate(detail.workOrder.receivedAt, locale, shop.timezone)}
          pieces={
            detail.pieces.length > 0
              ? detail.pieces.map((piece) => ({
                  id: piece.id,
                  name: gearItemKindLabel(t, piece.kind),
                  detail: [piece.brandModel, piece.serialNumber].filter(Boolean).join(" · "),
                }))
              : [
                  {
                    id: workOrderId,
                    name: detail.gearItemLabel ?? "",
                    detail: detail.gearItemKind ? gearItemKindLabel(t, detail.gearItemKind) : "",
                    tag: true,
                  },
                ]
          }
          problem={detail.workOrder.reportedProblem}
          promised={
            detail.workOrder.promisedOn
              ? formatCalendarDate(detail.workOrder.promisedOn, locale)
              : null
          }
          phone={shop.contactPhone}
        />
      </ShopSheet>
    </SheetDocument>
  );
}
