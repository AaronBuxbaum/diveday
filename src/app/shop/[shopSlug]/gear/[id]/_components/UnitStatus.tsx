import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { FormStatus } from "@/components/ui/form";
import type { GearItemDetail } from "@/db/gear";
import { gearStatusLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { benchReturnConcerns } from "@/lib/gear";
import { deleteGearItemAction, setGearItemStatusAction } from "../actions";
import { PullForServiceButton } from "./PullForServiceButton";

/**
 * The first line of the unit's summary panel (visual review 2026-10-24, A19):
 * its status, the bench note that put it there, and any concern a diver
 * raised returning it while it sat on the bench (#2540), which never
 * overwrites the technician's note.
 */
export function UnitStatusLine({
  detail,
  t,
  locale,
  zone,
}: {
  detail: GearItemDetail;
  t: StaffTranslator;
  locale: string;
  /** The shop's zone, for the day a concern came back. */
  zone: string;
}) {
  const { item } = detail;
  const concerns = benchReturnConcerns(item, detail.reservations, detail.history, zone);
  return (
    <div className="space-y-1">
      <p
        className={`text-sm font-medium ${
          item.status === "needs_service" ? "text-warning-strong" : "text-foreground"
        }`}
      >
        {gearStatusLabel(t, item.status)}
      </p>
      {item.status === "needs_service" && item.serviceNote ? (
        <p className="text-sm text-muted">{item.serviceNote}</p>
      ) : null}
      {concerns.length > 0 ? (
        <ul className="space-y-1 text-sm text-warning-strong">
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
    </div>
  );
}

/**
 * The summary's one act: off to the bench, or back on the wall. Deleting the
 * unit is not a status, so it lives at the page's foot (`DeleteUnitFoot`).
 */
export function StatusControls({ item, t }: { item: GearItemDetail["item"]; t: StaffTranslator }) {
  return (
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
    </div>
  );
}

/**
 * **Off the register, at the record's foot** (visual review A19). It stood
 * inside the summary panel under Pull for service, so the unit's own card
 * ended on its most final act. `held` is the reservation the delete would
 * strand — present only when the shop has just tried it and been refused, and
 * worded from the page's own read so the holder's name never rides in the URL.
 */
export function DeleteUnitFoot({
  item,
  held,
  t,
}: {
  item: GearItemDetail["item"];
  held: { name: string; until: string } | null;
  t: StaffTranslator;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
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
  );
}
