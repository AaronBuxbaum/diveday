import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { RowLink, Table, TBody, Td, THead, Th, Tr } from "@/components/ui/table";
import type { BlowoutDiverState } from "@/db/blowouts";
import type { PaymentStatus } from "@/db/schema";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { displayStoredPhoneWhole } from "@/lib/forgiving-fields";
import { formatDateTimeTz } from "@/lib/format";
import { shopPath } from "@/lib/staff-notices";

const TITLE_DATE_JOIN = " — ";
const PAYMENT_KEY: Record<PaymentStatus, StaffMessageKey> = {
  unpaid: "divers.shared.paymentStatus.unpaid",
  deposit_paid: "divers.shared.paymentStatus.depositPaid",
  paid: "divers.shared.paymentStatus.paid",
  waived: "divers.shared.paymentStatus.waived",
  partly_refunded: "divers.shared.paymentStatus.partlyRefunded",
  refunded: "divers.shared.paymentStatus.refunded",
};

const MESSAGE_BADGE: Record<
  BlowoutDiverState["messageStatus"],
  { tone: BadgeTone; key: StaffMessageKey }
> = {
  sent: { tone: "success", key: "blowout.record.messageSent" },
  queued: { tone: "warning", key: "blowout.record.messageQueued" },
  pending: { tone: "warning", key: "blowout.record.messagePending" },
  sending: { tone: "warning", key: "blowout.record.messageSending" },
  failed: { tone: "danger", key: "blowout.record.messageFailed" },
  no_email: { tone: "neutral", key: "blowout.record.messageNoEmail" },
};

/** Recovery groups retain independent delivery, payment and offered-departure facts. */
export function RecoveryGroups({
  divers,
  shopSlug,
  locale,
  timezone,
  t,
}: {
  divers: readonly BlowoutDiverState[];
  shopSlug: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const recoveryGroups = [
    {
      id: "unresolved-recovery",
      title: t("blowout.record.unresolved"),
      rows: divers.filter((diver) => !diver.rebooked),
    },
    {
      id: "rebooked-recovery",
      title: t("blowout.record.rebooked"),
      rows: divers.filter((diver) => diver.rebooked),
    },
  ];
  return (
    <div className="mt-6 space-y-8">
      {recoveryGroups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <section key={group.id} aria-labelledby={group.id}>
            <h2 id={group.id} tabIndex={-1} className="scroll-mt-28 text-base font-semibold">
              {group.title} · {group.rows.length}
            </h2>
            <Table shellClassName="mt-3">
              <THead>
                <Th>{t("blowout.record.table.diver")}</Th>
                <Th hideBelow="sm">{t("blowout.record.table.message")}</Th>
                <Th hideBelow="sm">{t("blowout.record.table.money")}</Th>
                <Th hideBelow="md">{t("blowout.record.table.offers")}</Th>
                <Th hideBelow="sm">{t("blowout.record.table.status")}</Th>
              </THead>
              <TBody>
                {group.rows.map((diver) => {
                  const message = MESSAGE_BADGE[diver.messageStatus];
                  return (
                    // `align="baseline"` on every cell: the two Badge columns put
                    // their word on the row's line, not under it. A `Tr`, because
                    // the name's `RowLink` overlay positions against its
                    // `relative`: the name is the row's one door, and it was a
                    // 17–37px target (K-322). `clip={false}` keeps that overlay
                    // row-wide (a clipping cell bounds it to itself, #1989), and
                    // `break-words` wraps the name the dropped clip no longer cuts.
                    <Tr key={diver.id}>
                      <Td clip={false} align="baseline" className="break-words text-base">
                        <RowLink
                          href={shopPath(shopSlug, "divers", diver.personId)}
                          className="font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {diver.fullName}
                        </RowLink>
                        <div className="mt-2 flex flex-wrap gap-2 sm:hidden">
                          <Badge tone={message.tone} size="lg">
                            {t(message.key)}
                          </Badge>
                          <Badge tone={diver.rebooked ? "success" : "warning"} size="lg">
                            {t(
                              diver.rebooked
                                ? "blowout.record.rebookedBadge"
                                : "blowout.record.unresolvedBadge",
                            )}
                          </Badge>
                        </div>
                        <p className="relative z-10 mt-2 text-base text-muted sm:hidden">
                          {diver.paymentStatus
                            ? t(PAYMENT_KEY[diver.paymentStatus])
                            : t("blowout.record.noPayment")}
                        </p>
                        <div className="relative z-10 mt-1 md:hidden">
                          {diver.offeredTrips.length === 0 ? (
                            <p className="text-base text-muted">{t("blowout.record.noOffers")}</p>
                          ) : (
                            <details>
                              <summary className="flex min-h-11 cursor-pointer items-center text-base text-primary">
                                {t("blowout.record.offeredCount", {
                                  count: diver.offeredTrips.length,
                                })}
                              </summary>
                              <ul className="space-y-2 text-base">
                                {diver.offeredTrips.map((offer) => (
                                  <li key={offer.id}>
                                    <Link
                                      href={shopPath(shopSlug, "trips", offer.id)}
                                      className={buttonClass({
                                        variant: "link",
                                        size: "sm",
                                        flush: true,
                                        className: "text-base",
                                      })}
                                    >
                                      {offer.title}
                                      {TITLE_DATE_JOIN}
                                      {formatDateTimeTz(offer.startsAt, locale, timezone)}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                        {/* Over the name's overlay (`relative z-10`, as
                        `LedgerRow` lifts its trailing slot): under it, a tap on
                        the number opened the record, and the number could be
                        neither selected nor tapped to call — on the page for
                        reaching the divers the cascade could not email. */}
                        {diver.messageStatus === "no_email" && diver.phone ? (
                          <div className="relative z-10 text-base text-muted">
                            {t("blowout.record.callThem", {
                              phone: displayStoredPhoneWhole(diver.phone),
                            })}
                          </div>
                        ) : null}
                      </Td>
                      <Td align="baseline" hideBelow="sm">
                        <Badge tone={message.tone} size="sm">
                          {t(message.key)}
                        </Badge>
                      </Td>
                      <Td muted hideBelow="sm" align="baseline">
                        {diver.paymentStatus
                          ? t(PAYMENT_KEY[diver.paymentStatus])
                          : t("blowout.record.noPayment")}
                      </Td>
                      <Td muted hideBelow="md" align="baseline">
                        {/* One offer per line, its date one unbroken run: joined
                        with " · " in this ~163px column, two or three dates
                        broke across lines on every row (K-323). Only a title
                        may wrap, and the dash stays with it. */}
                        {diver.offeredTrips.length === 0 ? (
                          t("blowout.record.noOffers")
                        ) : (
                          <ul className="space-y-1">
                            {diver.offeredTrips.map((offer) => (
                              <li key={offer.id}>
                                <Link
                                  href={shopPath(shopSlug, "trips", offer.id)}
                                  className="relative z-10 inline-flex min-h-11 items-center text-primary hover:underline"
                                >
                                  {offer.title}
                                  {TITLE_DATE_JOIN}
                                  {formatDateTimeTz(offer.startsAt, locale, timezone)}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td align="baseline" hideBelow="sm">
                        {diver.rebooked ? (
                          <Badge tone="success" size="sm">
                            {t("blowout.record.rebookedBadge")}
                          </Badge>
                        ) : (
                          <Badge tone="warning" size="sm">
                            {t("blowout.record.unresolvedBadge")}
                          </Badge>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </section>
        ))}
    </div>
  );
}
