import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { FormStatus } from "@/components/ui/form";
import type { GearItemDetail } from "@/db/gear";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { benchReturnConcerns } from "@/lib/gear";
import { deleteGearItemAction, setGearItemStatusAction } from "../actions";
import { PullForServiceButton } from "./PullForServiceButton";

/**
 * The two ways a unit leaves the wall: off to the bench, or off the register
 * altogether. `held` is the reservation the delete would strand — present only
 * when the shop has just tried it and been refused, and worded from the page's
 * own read so the holder's name never rides in the URL.
 */
export function StatusCard({
  detail,
  held,
  t,
  locale,
  zone,
}: {
  detail: GearItemDetail;
  held: { name: string; until: string } | null;
  t: StaffTranslator;
  locale: string;
  /** The shop's zone, for the day a concern came back. */
  zone: string;
}) {
  const { item } = detail;
  // Concerns returned while the unit is on the bench, which never overwrite
  // the technician's note (#2540).
  const concerns = benchReturnConcerns(item, detail.reservations, detail.history, zone);
  return (
    <SectionCard
      padding="lg"
      title={t("gear.unit.status.title")}
      description={
        item.status === "needs_service" && item.serviceNote ? item.serviceNote : undefined
      }
    >
      {/* **Not a column.** A `flex-col` stretched both controls to the card's
          full width, which made "Delete unit" the widest, heaviest-looking
          thing on the record — a unit's resting state is one act wide. The
          delete sits beneath it at link weight, in danger ink, where it is
          still one tap and no longer the section's loudest control. */}
      {concerns.length > 0 ? (
        <ul className="mb-4 space-y-1 text-sm text-warning-strong">
          {concerns.map((concern) => (
            <li key={`${concern.returnedOn}:${concern.note}`}>
              {t("gear.unit.status.returnedConcern", {
                date: formatCalendarDate(concern.returnedOn, locale),
                note: concern.note,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        {item.status === "in_service" ? (
          <PullForServiceButton
            gearItemId={item.id}
            action={setGearItemStatusAction}
            copy={{
              trigger: t("gear.unit.status.pull"),
              noteLabel: t("gear.unit.status.pullNote"),
              noteHint: t("gear.form.optionalHint"),
              notePlaceholder: t("gear.unit.status.pullNotePlaceholder"),
              cancel: t("gear.unit.status.pullCancel"),
              pending: t("gear.unit.status.pulling"),
            }}
          />
        ) : (
          <form action={setGearItemStatusAction}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <input type="hidden" name="status" value="in_service" />
            <SubmitButton
              pendingLabel={t("gear.unit.status.reinstating")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("gear.unit.status.reinstate")}
            </SubmitButton>
          </form>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <form action={deleteGearItemAction}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <SubmitButton
              pendingLabel={t("gear.unit.status.deleting")}
              className={buttonClass({ variant: "danger-ghost", size: "sm", flush: true })}
            >
              {t("gear.unit.status.delete")}
            </SubmitButton>
          </form>
          <FormStatus>
            {held ? t("gear.unit.status.deleteHeld", { name: held.name, until: held.until }) : null}
          </FormStatus>
        </div>
      </div>
    </SectionCard>
  );
}
