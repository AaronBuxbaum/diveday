import { ChoiceRow } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** The course switches, each one checkbox named by its label and described by its hint. */
const SWITCHES = [
  {
    name: "nitroxCompatible",
    label: "courses.edit.nitroxCompatibleLabel",
    hint: "courses.edit.nitroxCompatibleHint",
  },
  {
    name: "gearIncluded",
    label: "courses.edit.gearIncludedLabel",
    hint: "courses.edit.gearIncludedHint",
  },
] as const;

/**
 * **How the course runs, in the shop's own answers**: whether it may run on
 * enriched air (`nitroxAvailableOn`, src/lib/rentals.ts), and whether rental
 * gear is part of the course fee (fifth-loop ideas, item 16), which takes the
 * rental prices off a student's `/ready`.
 *
 * One item each in the section's `gap-5` column, with no margin of its own.
 * Each hint is the next line of its own words at a `Field` description's 12px
 * (K-414); the box is named by its label alone and described by the hint, as a
 * `Field`'s control is.
 */
export function CourseSwitches({
  course,
  t,
}: {
  course: { nitroxCompatible: boolean; gearIncluded: boolean };
  t: StaffTranslator;
}) {
  return SWITCHES.map(({ name, label, hint }) => (
    <ChoiceRow
      key={name}
      type="checkbox"
      name={name}
      value="true"
      defaultChecked={course[name]}
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
  ));
}
