"use client";

import { useTranslations } from "next-intl";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";

/**
 * **"What can you dive?", asked once, on both of the lists that ask a diver to
 * wait for something.**
 *
 * The shop-wide last-minute-deal list and a full trip's wait list both used to
 * collect a name, an email, and nothing about diving — so a discount blast
 * could invite an Open Water diver onto a deep wreck charter the admission gate
 * would refuse the moment they clicked through (FU-20260813). These two inputs
 * are the fix, and what happens to the answer is the important half: it is
 * shown to the staffer doing the sending, marked self-declared. It never
 * filters a blast. See src/db/self-declared-cards.ts.
 *
 * **Both fields are optional, deliberately.** This is a marketing opt-in, and a
 * required question on one costs more sign-ups than it saves mistakes. A joiner
 * who skips shows to staff as "not said", which is honest and is also the
 * common case.
 *
 * One component rather than two copies because the two forms must ask the
 * identical question in the identical words — a staffer reading one panel and
 * then the other is reading the same claim, and two drifting selects would be
 * two different claims.
 *
 * Needs `DiverIntlProvider` above it carrying the `common` and `course`
 * namespaces (`course` is where the diver-facing level words live, shared with
 * the public course pages through `DIVER_CERTIFICATION_LEVEL_KEYS`).
 */
export function DiveDeclarationFields() {
  const t = useTranslations();
  return (
    // A self-contained block with its own grid, dropped in *beside* each form's
    // existing `FieldGrid` rather than into it: a `Field` is a two-row subgrid
    // item and the checkbox is not, so mixing them into a caller's grid knocks
    // every field after them half a row out of step — the staircase the
    // last-minute form's own spacer comment already records.
    <div className="flex flex-col gap-3">
      <FieldGrid columns={2}>
        <Field
          label={t("common.diveProfile.level")}
          hint={t("common.optional")}
          description={t("common.diveProfile.levelDescription")}
        >
          <select name="certificationLevel" defaultValue="" className={controlClass}>
            {/* First and pre-selected: skipping is the default, not something
                the diver has to go back and choose. */}
            <option value="">{t("common.diveProfile.levelUnsaid")}</option>
            {Object.entries(DIVER_CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </Field>
      </FieldGrid>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="nitroxCertified"
          value="on"
          className="mt-0.5 size-4 shrink-0 rounded border-border-strong"
        />
        <span>{t("common.diveProfile.nitrox")}</span>
      </label>
    </div>
  );
}
