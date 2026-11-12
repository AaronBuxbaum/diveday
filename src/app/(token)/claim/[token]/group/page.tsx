import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { DeadLink } from "@/components/DeadLink";
import { ThreadShell } from "@/components/thread/ThreadShell";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getGroupClaimPageData } from "@/features/seat-claims";
import { diverTranslator } from "@/i18n/messages";
import { requestLocale } from "@/i18n/request";
import { claimLinkPath } from "@/lib/booking-capabilities";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";

export const instant = true;
export async function generateMetadata(): Promise<Metadata> {
  const t = diverTranslator(await requestLocale());
  return { title: t("seatClaim.groupHeading"), robots: { index: false, follow: false } };
}
export default async function GroupClaimPage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const data = await getGroupClaimPageData(await getDb(), token);
  const locale = await requestLocale(data?.defaultLocale);
  const t = diverTranslator(locale);
  if (!data) return <DeadLink t={t} next={t("seatClaim.unavailableBody")} diveDayDoor={false} />;
  return (
    <ThreadShell
      shopName={data.shopName}
      title={data.title}
      meta={
        <p className="mt-1 text-base text-muted">
          {formatShortDate(data.startsAt, locale, data.timezone)} ·{" "}
          {formatTimeRangeTz(data.startsAt, data.endsAt, locale, data.timezone)}
        </p>
      }
    >
      <section className="mt-8 space-y-4">
        <h2 className={SECTION_TITLE_CLASS}>{t("seatClaim.groupHeading")}</h2>
        <p className="text-base text-muted">
          {t(data.seats.length ? "seatClaim.groupBody" : "seatClaim.groupEmpty")}
        </p>
        <ul className="space-y-3">
          {data.seats.map((seat) => (
            <li key={seat.claim.token}>
              <Link
                href={claimLinkPath(seat.claim.token)}
                className={buttonClass({ variant: "secondary", className: "w-full justify-start" })}
              >
                {seat.seatName}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </ThreadShell>
  );
}
