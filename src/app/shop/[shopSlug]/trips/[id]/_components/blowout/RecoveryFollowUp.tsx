import { randomUUID } from "node:crypto";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { BlowoutDiverState } from "@/db/blowouts";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { RECOVERY_OUTCOMES } from "@/lib/disruption-recovery";
import { formatDateTimeTz } from "@/lib/format";
import { recordRecoveryFollowUpAction } from "../../blowout-actions";

export function RecoveryFollowUp({
  diver,
  shopSlug,
  tripId,
  locale,
  timezone,
  t,
}: {
  diver: BlowoutDiverState;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const latest = diver.recoveryEvents.at(-1);
  const outcome = latest?.outcome ?? "pending";
  return (
    <details className="relative z-10 mt-2 text-base">
      <summary className="flex min-h-11 cursor-pointer items-center text-primary">
        {t("blowout.recovery.forDiver", { name: diver.fullName })}
      </summary>
      <p className="mt-2 text-muted">{t("blowout.recovery.boundary")}</p>
      {diver.canRecordRecovery ? (
        <form
          action={recordRecoveryFollowUpAction.bind(null, shopSlug, tripId)}
          className="mt-3 grid max-w-3xl gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="blowoutDiverId" value={diver.id} />
          <input type="hidden" name="attemptId" value={randomUUID()} />
          <input type="hidden" name="revision" value={diver.recoveryEvents.length} />
          <Field label={t("blowout.recovery.outcome")}>
            <select name="outcome" defaultValue={outcome} className={controlClass}>
              {RECOVERY_OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {t(`blowout.recovery.${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("blowout.recovery.booking")}>
            <select
              name="replacementBookingId"
              defaultValue={diver.rebooked ? (diver.replacementBookingId ?? "") : ""}
              className={controlClass}
            >
              <option value="">{t("blowout.recovery.chooseBooking")}</option>
              {diver.recoveryBookings.map((booking) => (
                <option key={booking.id} value={booking.id}>
                  {booking.title} · {formatDateTimeTz(booking.startsAt, locale, timezone)}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <SubmitButton
              pendingLabel={t("words.busy.saving")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("blowout.recovery.save")}
            </SubmitButton>
          </div>
        </form>
      ) : null}
      {diver.recoveryEvents.length > 0 ? (
        <ol
          aria-label={t("blowout.recovery.history")}
          className="mt-4 space-y-2 text-sm text-muted"
        >
          {diver.recoveryEvents.toReversed().map((event) => (
            <li key={event.attemptId}>
              {t(`blowout.recovery.${event.outcome}`)} ·{" "}
              {diver.recoveryActors[event.actorPersonId] ?? "—"} ·{" "}
              {formatDateTimeTz(new Date(event.recordedAt), locale, timezone)}
            </li>
          ))}
        </ol>
      ) : null}
      {outcome === "rebooked" && !diver.rebooked ? (
        <p className="mt-2 text-muted">{t("blowout.recovery.bookingUnavailable")}</p>
      ) : null}
    </details>
  );
}
