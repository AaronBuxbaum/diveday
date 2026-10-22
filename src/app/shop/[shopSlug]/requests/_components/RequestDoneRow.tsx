import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { LedgerRow } from "@/components/ui/ledger";
import type { DateInterestRow } from "@/db/interest-dates";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatShortDate } from "@/lib/format";

/**
 * **A request the shop has closed** (third UX review, item 13): who asked, what
 * for, and how it was closed, one quiet line under "Done". Booked or marked
 * done, the interest no longer counts in its day's groups and divers; Reopen puts
 * it back if the tick was a mistake.
 */
export function RequestDoneRow({
  request,
  locale,
  timezone,
  reopenAction,
  t,
}: {
  request: DateInterestRow & { closedAt: Date; closedAs: "booked" | "done" };
  locale: string;
  timezone: string;
  reopenAction: (formData: FormData) => void;
  t: StaffTranslator;
}) {
  const name = request.name ?? t("requests.anonymous");
  const ask = request.courseTitle
    ? t("requests.aboutCourse", { course: request.courseTitle })
    : t("requests.aboutDive", { interest: request.interest ?? "" });
  const date = formatShortDate(request.closedAt, locale, timezone);
  const how =
    request.closedAs === "booked"
      ? t("requests.done.booked", { date })
      : t("requests.done.marked", { date });
  return (
    <LedgerRow
      as="li"
      pad="lg"
      align="first-line"
      stacked
      trailing={
        <form action={reopenAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <input type="hidden" name="outcome" value="open" />
          <SubmitButton
            pendingLabel={t("requests.reopen")}
            className={buttonClass({
              variant: "link",
              size: "sm",
              flush: true,
              outdent: "block-end-phone",
              className: "focus-visible:focus-ring-inset",
            })}
          >
            {t("requests.reopen")}
          </SubmitButton>
        </form>
      }
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <p className="min-w-0 text-muted sm:w-44 sm:shrink-0">{name}</p>
        <div className="min-w-0 flex-1">
          <p className="text-muted">{ask}</p>
          <p className="mt-0.5 text-sm text-muted tabular-nums">{how}</p>
        </div>
      </div>
    </LedgerRow>
  );
}
