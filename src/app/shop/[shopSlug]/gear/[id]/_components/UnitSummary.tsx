import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import type { GearItemDetail } from "@/db/gear";
import { gearItemKindLabel } from "@/i18n/gear-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatShortDate } from "@/lib/format";
import { GEAR_KIND_ORDER } from "@/lib/gear";
import { RENTAL_FIT_TEXT_LIMITS } from "@/lib/rentals";
import { restoreGearItemAction } from "../../actions";
import { updateGearItemAction } from "../actions";
import type { GearUnitHull } from "./AboardBoatField";
import { KindFacts } from "./KindFacts";
import { StatusControls, UnitStatusLine } from "./UnitStatus";

/**
 * **One summary panel** (visual review 2026-10-24, A19): the status line, the
 * record's facts as a list, and the acts that change the unit's standing.
 * Status and Details were two cards, and Details held nothing but its own
 * Edit door. "Edit details" is the page header's door now; the form opens
 * here, server-rendered (`?edit=details`), and a refused save comes back to
 * it standing.
 *
 * A deleted unit's record is read-only (`getGearItemDetail` reports the stamp
 * rather than hiding the row), so its panel says when it came off the register
 * and offers the one act that reverses it. The restore is the register's own
 * action, so a refused one (another unit wears this one's tag now) lands on
 * the register beside the fleet that refused it.
 */
export function UnitSummary({
  detail,
  hull,
  held,
  editing,
  unitPath,
  t,
  locale,
  zone,
}: {
  detail: GearItemDetail;
  hull: GearUnitHull;
  held: { name: string; until: string } | null;
  editing: boolean;
  /** The unit's own page, which Cancel returns to. */
  unitPath: string;
  t: StaffTranslator;
  locale: string;
  /** The shop's zone. */
  zone: string;
}) {
  const { item } = detail;
  const deletedAt = item.deletedAt;
  const facts = [
    { label: t("gear.form.size"), value: item.size },
    { label: t("gear.form.brandModel"), value: item.brandModel },
    { label: t("gear.form.serialNumber"), value: item.serialNumber },
    {
      label: t("gear.form.purchasedOn"),
      value: item.purchasedOn ? formatCalendarDate(item.purchasedOn, locale) : null,
    },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));
  return (
    <SectionCard
      id="unit-details"
      padding="lg"
      aria-label={t("gear.unit.details.title")}
      className="scroll-mt-24"
    >
      {deletedAt ? (
        <p className="text-sm font-medium">
          {t("gear.deleted.on", {
            date: formatShortDate(deletedAt, locale, zone),
          })}
        </p>
      ) : (
        <UnitStatusLine detail={detail} t={t} locale={locale} zone={zone} />
      )}
      {facts.length > 0 ? (
        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm">
          {facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted">{fact.label}</dt>
              <dd className="min-w-0 break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {editing ? (
        <div className="mt-6 border-t border-border pt-6">
          <FieldGrid as="form" action={updateGearItemAction} columns={2}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <Field label={t("gear.form.kind")}>
              <select name="kind" className={controlClass} defaultValue={item.kind}>
                {GEAR_KIND_ORDER.map((option) => (
                  <option key={option} value={option}>
                    {gearItemKindLabel(t, option)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("gear.form.label")} hint={t("gear.form.labelHint")}>
              <input
                name="label"
                required
                maxLength={80}
                defaultValue={item.label}
                className={controlClass}
              />
            </Field>
            {/* The action's own cap, which is the fit forms' cap
              (`RENTAL_FIT_TEXT_LIMITS.size`) because `keepRentalFitAction`
              copies this value into `rental_fit_profiles` — issue #1754. */}
            <Field label={t("gear.form.size")} hint={t("gear.form.optionalHint")}>
              <input
                name="size"
                maxLength={RENTAL_FIT_TEXT_LIMITS.size}
                defaultValue={item.size ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("gear.form.serialNumber")} hint={t("gear.form.optionalHint")}>
              <input
                name="serialNumber"
                maxLength={80}
                defaultValue={item.serialNumber ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("gear.form.brandModel")} hint={t("gear.form.optionalHint")}>
              <input
                name="brandModel"
                maxLength={120}
                defaultValue={item.brandModel ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label={t("gear.form.purchasedOn")} hint={t("gear.form.optionalHint")}>
              <DateField name="purchasedOn" defaultValue={item.purchasedOn ?? ""} />
            </Field>
            <KindFacts hull={hull} item={item} t={t} />
            <FieldActions>
              <SubmitButton pendingLabel={t("gear.unit.details.saving")} className={buttonClass()}>
                {t("gear.unit.details.save")}
              </SubmitButton>
              <Link href={unitPath} className={buttonClass({ variant: "ghost" })}>
                {t("gear.unit.details.cancel")}
              </Link>
            </FieldActions>
          </FieldGrid>
        </div>
      ) : null}
      <div className="mt-6 border-t border-border pt-4">
        {deletedAt ? (
          <form action={restoreGearItemAction}>
            <input type="hidden" name="gearItemId" value={item.id} />
            <SubmitButton
              pendingLabel={t("gear.deleted.restoring")}
              className={buttonClass({ variant: "secondary" })}
            >
              {t("gear.unit.deleted.restore")}
            </SubmitButton>
          </form>
        ) : (
          <StatusControls item={item} held={held} t={t} />
        )}
      </div>
    </SectionCard>
  );
}
