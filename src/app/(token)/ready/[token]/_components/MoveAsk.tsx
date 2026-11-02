import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field } from "@/components/ui/form";
import type { ReadyPageData } from "@/db/ready";
import type { DiverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import { formatDateTimeTz } from "@/lib/format";
import { MOVE_ASK_NOTE_MAX_LENGTH } from "@/lib/inbox";

/**
 * **"Ask to move"** (H-126). Past the free-cancellation window the only
 * button the diver had was one that forfeits what they paid. This sits above
 * it: a request to the shop for another date, with an optional note and the
 * shop's phone, that lands in the shop's Inbox against the seat. Staff decide;
 * nothing moves from here.
 *
 * Rendered only while `moveAsk` is set; once asked it says so in place of the
 * form, so the same ask is never offered twice.
 */
export function MoveAsk({
  state,
  tripId,
  locale,
  timeZone,
  shopName,
  shopPhone,
  action,
  t,
}: {
  state: NonNullable<ReadyPageData["moveAsk"]>;
  tripId: string;
  locale: DiverLocale;
  timeZone: string;
  shopName: string;
  shopPhone: string | null;
  action: (formData: FormData) => Promise<void>;
  t: DiverTranslator;
}) {
  if (state !== "open") {
    return (
      <div id="move-ask" tabIndex={-1} className="scroll-mt-8 flex flex-col gap-2 text-base">
        <p className="font-medium">{t("ready.moveAsk.asked", { shop: shopName })}</p>
        {state.note ? <p className="whitespace-pre-wrap wrap-anywhere">{state.note}</p> : null}
        <p className="text-muted">
          <time dateTime={state.sentAt.toISOString()}>
            {t("ready.moveAsk.sentAt", { when: formatDateTimeTz(state.sentAt, locale, timeZone) })}
          </time>
        </p>
        <p className="text-muted">{t("ready.moveAsk.bookingUnchanged")}</p>
      </div>
    );
  }
  return (
    <div id="move-ask" tabIndex={-1} className="scroll-mt-8 flex flex-col gap-3">
      <p className="text-base text-muted">
        {shopPhone
          ? t("ready.moveAsk.body", { shop: shopName, phone: shopPhone })
          : t("ready.moveAsk.bodyNoPhone", { shop: shopName })}
      </p>
      <form action={action} className="flex flex-wrap items-end gap-3 print:hidden">
        <input type="hidden" name="tripId" value={tripId} />
        <Field label={t("ready.moveAsk.noteLabel")} className="min-w-56 flex-1">
          <input
            name="note"
            type="text"
            maxLength={MOVE_ASK_NOTE_MAX_LENGTH}
            autoComplete="off"
            className={controlClass}
          />
        </Field>
        <SubmitButton
          pendingLabel={t("ready.moveAsk.pending")}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("ready.moveAsk.action")}
        </SubmitButton>
      </form>
    </div>
  );
}
