import Link from "next/link";
import type { ReactNode } from "react";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { EmptyState } from "@/components/EmptyState";
import { FlashParams } from "@/components/FlashParams";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The deliberate confirmation is a reading surface; the resulting report scans wider. */
export function BlowoutConfirmation({
  header,
  notice,
  trip,
  departed,
  mayRefund,
  dayHref,
  roster,
  call,
  t,
}: {
  header: ReactNode;
  notice: ReactNode;
  trip: { title: string };
  departed: boolean;
  mayRefund: boolean;
  dayHref: string | null;
  roster: readonly {
    booking: { id: string };
    person: { fullName: string; email: string | null };
  }[];
  call: () => Promise<void>;
  t: StaffTranslator;
}) {
  return (
    <StaffPage width="reading">
      <FlashParams params={["notice"]} />
      {header}
      <div className="mt-6">{notice}</div>
      <SectionCard as="div" padding="lg">
        <p className="text-sm">{t("blowout.confirm.lead", { tripTitle: trip.title })}</p>
        <p className="mt-3 text-sm text-muted">
          {t(mayRefund ? "blowout.confirm.moneyNote" : "blowout.confirm.moneyNoteHeld")}
        </p>
        {!dayHref ? null : (
          // The whole morning is usually what the weather closes (ADR
          // 20261009-day-weather-call); calling the boats one at a time
          // offered each boat's divers the next one about to be called.
          <Link
            href={dayHref}
            className={`mt-3 ${buttonClass({ variant: "link", size: "sm", flush: true })}`}
          >
            {t("blowout.day.instead")}
          </Link>
        )}
        {roster.length === 0 ? (
          // Nested inside the confirm card, so no icon, fill or shadow.
          <EmptyState title={t("blowout.confirm.noDivers")} icon={false} nested className="mt-5" />
        ) : (
          <div className="mt-5">
            <h2 className="text-sm font-semibold">
              {t("blowout.confirm.diversHeading", { count: roster.length })}
            </h2>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {roster.map((row) => (
                <li key={row.booking.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0">{row.person.fullName}</span>
                  {row.person.email ? null : (
                    <Badge tone="neutral" size="sm">
                      {t("blowout.confirm.noEmail")}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {departed ? (
          <p className="mt-6 text-sm font-medium text-danger">{t("blowout.confirm.departed")}</p>
        ) : (
          <form action={call} className="mt-6">
            <SubmitButton
              pendingLabel={t("blowout.confirm.calling")}
              className={buttonClass({ variant: "danger" })}
            >
              {t("blowout.confirm.button")}
            </SubmitButton>
          </form>
        )}
      </SectionCard>
    </StaffPage>
  );
}
