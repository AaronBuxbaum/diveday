import { ChoiceFieldset, ChoiceRow } from "@/components/ui/form";
import { COURSE_PERSONAL_GEAR_STAFF_KEYS } from "@/i18n/packing-labels";
import { rentableItemLabel } from "@/i18n/rental-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { COURSE_PERSONAL_GEAR, type CoursePersonalGear } from "@/lib/course-personal-gear";
import {
  type RentableItemKind,
  SCUBA_UNIT_PRESET,
  toIncludedRentalKinds,
  toRentableKinds,
} from "@/lib/rentals";

/** One checkbox named by its label and described by its hint, as a `Field`'s control is. */
function CourseSwitch({
  name,
  label,
  hint,
  checked,
  t,
}: {
  name: string;
  label: StaffMessageKey;
  hint: StaffMessageKey;
  checked: boolean;
  t: StaffTranslator;
}) {
  return (
    <ChoiceRow
      type="checkbox"
      name={name}
      value="true"
      defaultChecked={checked}
      aria-labelledby={`${name}-label`}
      aria-describedby={`${name}-hint`}
      className="text-sm"
    >
      <span id={`${name}-label`} className="block">
        {t(label)}
      </span>
      <span id={`${name}-hint`} className="block text-xs text-muted">
        {t(hint)}
      </span>
    </ChoiceRow>
  );
}

/**
 * The kinds a course fee can include: what the shop rents, plus anything the
 * course already includes that the shop has since stopped renting, so a save
 * never quietly drops it. Catalog order.
 */
function includableKinds(
  rentalItems: readonly string[],
  included: readonly RentableItemKind[],
): RentableItemKind[] {
  return toIncludedRentalKinds([...toRentableKinds(rentalItems), ...included]);
}

/**
 * **How the course runs, in the shop's own answers**: whether it may run on
 * enriched air (`nitroxAvailableOn`, src/lib/rentals.ts), and which rental
 * gear is part of the course fee (fifth-loop ideas item 16, issue #2796),
 * which takes those prices off a student's `/ready` and those pieces off
 * their "Bring" list.
 *
 * The gear is one box, as it was, and the kinds open under it only once it is
 * ticked, preset to the scuba unit (`SCUBA_UNIT_PRESET`): a shop that does
 * nothing sees one row, and a shop that ticks it and stops there gets what the
 * yes/no meant. The reveal is CSS (`group-has`), so the page needs no script
 * for it, and the action ignores the kinds while the box is unticked.
 *
 * One item each in the section's `gap-5` column, with no margin of its own.
 * Each hint is the next line of its own words at a `Field` description's 12px
 * (K-414).
 */
export function CourseSwitches({
  course,
  rentalItems,
  t,
}: {
  course: {
    nitroxCompatible: boolean;
    includedRentalKinds: RentableItemKind[];
    includedPersonalGear?: readonly CoursePersonalGear[];
  };
  /** The shop's rental catalog (`shops.rental_items`): the kinds the fee can include. */
  rentalItems: readonly string[];
  t: StaffTranslator;
}) {
  const included = course.includedRentalKinds;
  const personal = course.includedPersonalGear ?? [];
  const hasIncluded = included.length > 0 || personal.length > 0;
  const ticked = new Set(hasIncluded ? included : SCUBA_UNIT_PRESET);
  const kinds = includableKinds(rentalItems, included);
  return (
    <>
      <CourseSwitch
        name="nitroxCompatible"
        label="courses.edit.nitroxCompatibleLabel"
        hint="courses.edit.nitroxCompatibleHint"
        checked={course.nitroxCompatible}
        t={t}
      />
      <div className="group/gear grid gap-2">
        <CourseSwitch
          name="gearIncluded"
          label="courses.edit.gearIncludedLabel"
          hint="courses.edit.gearIncludedHint"
          checked={hasIncluded}
          t={t}
        />

        <ChoiceFieldset
          legend={t("courses.edit.includedKindsLegend")}
          data-testid="course-included-kinds"
          className="hidden ps-7 group-has-[input[name=gearIncluded]:checked]/gear:block"
          bodyClassName="grid grid-cols-2 gap-x-4 sm:grid-cols-3"
        >
          {kinds.map((kind) => (
            <ChoiceRow
              key={kind}
              type="checkbox"
              name="includedRentalKind"
              value={kind}
              defaultChecked={ticked.has(kind)}
              className="text-sm"
            >
              {rentableItemLabel(t, kind)}
            </ChoiceRow>
          ))}
          {COURSE_PERSONAL_GEAR.map((kind) => (
            <ChoiceRow
              key={kind}
              type="checkbox"
              name="includedPersonalGear"
              value={kind}
              defaultChecked={personal.includes(kind)}
              className="text-sm"
            >
              {t(COURSE_PERSONAL_GEAR_STAFF_KEYS[kind])}
            </ChoiceRow>
          ))}
        </ChoiceFieldset>
      </div>
    </>
  );
}
