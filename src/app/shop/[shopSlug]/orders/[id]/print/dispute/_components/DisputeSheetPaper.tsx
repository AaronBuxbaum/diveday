import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { SECTION_TITLE_CLASS, SHELL_TITLE_CLASS } from "@/components/ui/typography";
import { activityLine } from "@/i18n/activity-labels";
import { rollCallCheckpointText } from "@/i18n/manifest-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type {
  DisputeRollCallResult,
  DisputeSheet,
  DisputeSignatureMethod,
} from "@/lib/dispute-sheet";
import {
  formatDateTimeTz,
  formatDateWithYear,
  formatMoneyCents,
  formatTimeZoneName,
} from "@/lib/format";
import { lineKindKey, STATUS_KEYS } from "../../../order-detail-keys";

const RESULT_KEYS: Record<DisputeRollCallResult, StaffMessageKey> = {
  boarded: "disputeSheet.resultBoarded",
  not_boarded: "disputeSheet.resultNotBoarded",
  not_recorded: "disputeSheet.resultNotRecorded",
};

const METHOD_KEYS: Record<DisputeSignatureMethod, StaffMessageKey> = {
  online: "disputeSheet.waiverMethodOnline",
  counter: "disputeSheet.waiverMethodCounter",
  imported: "disputeSheet.waiverMethodImported",
};

/**
 * **What a seat's dispute sheet says** (issue #2390), inside the shop's sheet:
 * the order, the release the diver signed, the check-in and every roll-call
 * result. It prints the `DisputeSheet` it is handed and nothing else: what may
 * appear is decided in `assembleDisputeSheet` (src/lib/dispute-sheet.ts), so it
 * cannot show a medical answer it never receives. Pure, and holds no control.
 */
export function DisputeSheetPaper({
  sheet,
  t,
  locale,
  timezone,
}: {
  sheet: DisputeSheet;
  t: StaffTranslator;
  locale: string;
  timezone: string;
}) {
  const dateTime = (date: Date) => formatDateTimeTz(date, locale, timezone);
  const money = (cents: number) => formatMoneyCents(cents, sheet.order.currency, locale);
  const { order, waiver, checkIn } = sheet;

  return (
    <div className="space-y-10">
      <header className="border-b border-border pb-6">
        <h1 className={SHELL_TITLE_CLASS}>{sheet.diverName}</h1>
        <p className="mt-1 text-muted">
          {sheet.trip.title}
          {" "}· {formatDateWithYear(sheet.trip.startsAt, locale, timezone)}
        </p>
        <p className="mt-3 max-w-prose text-sm text-muted">{t("disputeSheet.description")}</p>
        <p className="mt-2 max-w-prose text-sm font-semibold">{t("disputeSheet.factsOnly")}</p>
        <p className="mt-2 text-sm text-muted">
          {t("disputeSheet.printedLine", {
            date: dateTime(sheet.generatedAt),
            shop: sheet.shopName,
            timezone: formatTimeZoneName(locale, timezone),
          })}
        </p>
      </header>

      <section aria-labelledby="dispute-order-heading">
        <h2 id="dispute-order-heading" className={SECTION_TITLE_CLASS}>
          {t("disputeSheet.orderHeading")}
        </h2>
        <p className="mt-2 text-sm">
          {t("disputeSheet.orderStatus", {
            description: order.description || t("orders.detail.fallbackDescription"),
            status: STATUS_KEYS[order.status as keyof typeof STATUS_KEYS]
              ? t(STATUS_KEYS[order.status as keyof typeof STATUS_KEYS])
              : order.status,
          })}
        </p>
        <p className="mt-1 text-sm text-muted">
          {t("disputeSheet.orderRaised", { date: dateTime(order.createdAt) })}
          {order.paidAt ? (
            <>
              {" "}· {t("disputeSheet.orderPaid", { date: dateTime(order.paidAt) })}
            </>
          ) : null}
        </p>
        <ul className="mt-4 divide-y divide-border">
          {order.lines.map((line, index) => (
            <li
              // Lines carry no id here and are never reordered.
              // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
              key={index}
              className="flex items-baseline justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0 break-words">
                {t("disputeSheet.lineKind", {
                  description: line.description,
                  kind:
                    t(lineKindKey(line.kind)) + (line.quantity > 1 ? ` × ${line.quantity}` : ""),
                })}
              </span>
              <span className="shrink-0 tabular-nums">
                {money(line.unitAmountCents * line.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 text-sm">
          {order.taxCents > 0 ? (
            <Figure label={t("disputeSheet.tax")} value={money(order.taxCents)} />
          ) : null}
          <Figure label={t("disputeSheet.total")} value={money(order.totalCents)} strong />
          <Figure label={t("disputeSheet.amountPaid")} value={money(order.amountPaidCents)} />
          {order.refundedCents > 0 ? (
            <Figure label={t("disputeSheet.refunded")} value={money(order.refundedCents)} />
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="dispute-waiver-heading">
        <h2 id="dispute-waiver-heading" className={SECTION_TITLE_CLASS}>
          {t("disputeSheet.waiverHeading")}
        </h2>
        {waiver ? (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              {t("disputeSheet.waiverSigned", {
                title: waiver.templateTitle,
                version: waiver.templateVersion,
                date: dateTime(waiver.signedAt),
              })}
            </p>
            <p className="text-muted">
              {waiver.signedName
                ? t("disputeSheet.waiverSignedBy", { name: waiver.signedName })
                : t("disputeSheet.waiverSignedNameGone")}{" "}
              {t(METHOD_KEYS[waiver.method])}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("disputeSheet.waiverNone")}</p>
        )}
      </section>

      <section aria-labelledby="dispute-checkin-heading">
        <h2 id="dispute-checkin-heading" className={SECTION_TITLE_CLASS}>
          {t("disputeSheet.checkInHeading")}
        </h2>
        <p className={`mt-2 text-sm ${checkIn ? "" : "text-muted"}`}>
          {checkIn
            ? t(checkIn.offline ? "disputeSheet.checkInOffline" : "disputeSheet.checkIn", {
                date: dateTime(checkIn.at),
                name: checkIn.recordedByName,
              })
            : t("disputeSheet.checkInNone")}
        </p>
      </section>

      <section aria-labelledby="dispute-rollcall-heading">
        <h2 id="dispute-rollcall-heading" className={SECTION_TITLE_CLASS}>
          {t("disputeSheet.rollCallHeading")}
        </h2>
        <Table minWidth="36rem" shellClassName="mt-3">
          <THead>
            <Th>{t("disputeSheet.colCheckpoint")}</Th>
            <Th>{t("disputeSheet.colResult")}</Th>
            <Th>{t("disputeSheet.colRecorded")}</Th>
          </THead>
          <TBody>
            {sheet.rollCall.map((row) => (
              <tr key={row.checkpoint}>
                <Td>{rollCallCheckpointText(t, row.checkpoint)}</Td>
                <Td className={row.result === "not_recorded" ? "text-muted" : "font-medium"}>
                  {t(RESULT_KEYS[row.result])}
                </Td>
                <Td muted>
                  {row.at && row.recordedByName
                    ? t(row.offline ? "disputeSheet.recordedOffline" : "disputeSheet.recordedBy", {
                        date: dateTime(row.at),
                        name: row.recordedByName,
                      })
                    : null}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      </section>

      <section aria-labelledby="dispute-activity-heading">
        <h2 id="dispute-activity-heading" className={SECTION_TITLE_CLASS}>
          {t("disputeSheet.activityHeading")}
        </h2>
        {sheet.activity.length === 0 ? (
          <p className="mt-2 text-sm text-muted">{t("disputeSheet.activityNone")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {sheet.activity.map((line, index) => (
              <li
                // A trail line has no id on the sheet and the list is never reordered.
                // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
                key={index}
                className="py-2 text-sm"
              >
                {t("disputeSheet.activityLine", {
                  date: dateTime(line.at),
                  line: activityLine(t, { code: line.code, params: line.params }),
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex justify-end gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className={`tabular-nums ${strong ? "font-semibold" : "font-medium"}`}>{value}</dd>
    </div>
  );
}
