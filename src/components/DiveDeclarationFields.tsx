"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InfoHint } from "@/components/ui/InfoHint";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { NO_CERTIFICATION_ANSWER } from "@/lib/dive-declaration";

/**
 * **"What can you dive?", asked in the same words wherever it is asked.** The
 * two wait lists ask it, and since 2026-08-20 so does the trip booking form.
 *
 * **The answer is no longer only informational.** On the booking form
 * `decideTripAdmission` reads the level for that submission, so a diver who
 * names a rung the boat demands buys the seat and one who names a lower rung is
 * told at the sale (ADR 20260820-attested-at-booking-verified-at-boarding). The
 * sighting is still owed before boarding, and readiness still clears on
 * `verified` alone. On the two wait lists nothing gates on it at all — it is
 * shown to the staffer doing the sending, and never filters a blast.
 *
 * **The nitrox tick is currently rendered nowhere** (`showNitrox={false}` at
 * every call site), and the booking action deliberately refuses to honour a
 * hand-crafted one: a checkbox no diver on the page can reach must not be a
 * route past a nitrox gate.
 *
 * The shop-wide last-minute-deal list and a full trip's wait list both used to
 * collect a name, an email, and nothing about diving — so a discount blast
 * could invite an Open Water diver onto a deep wreck charter the admission gate
 * would refuse the moment they clicked through (FU-20260813). These two inputs
 * are the fix, and what happens to the answer is the important half: it is
 * shown to the staffer doing the sending, marked self-declared. It never
 * filters a blast. See src/db/self-declared-cards.ts.
 *
 * **The level field is optional, deliberately.** This is a marketing opt-in, and
 * a required question on one costs more sign-ups than it saves mistakes. A
 * joiner who skips shows to staff as "not said", which is honest and is also the
 * common case. The trip-specific wait list may additionally ask for a nitrox
 * declaration; the broad deal list does not.
 *
 * One component rather than two copies because the two forms must ask the
 * identical level question in the identical words — a staffer reading one
 * panel and then the other is reading the same claim, and two drifting selects
 * would be two different claims.
 *
 * Needs `DiverIntlProvider` above it carrying the `common` and `course`
 * namespaces (`course` is where the diver-facing level words live, shared with
 * the public course pages through `DIVER_CERTIFICATION_LEVEL_KEYS`).
 */
export function DiveDeclarationFields({ showNitrox = true }: { showNitrox?: boolean } = {}) {
  const t = useTranslations();
  // **What the diver picked, only so the form can stop contradicting itself.**
  // A joiner who says "I'm not certified yet" and also ticks "I'm certified for
  // nitrox" has said two incompatible things, and the writer resolves it by
  // recording the *absence* — the conservative direction. Without this the
  // diver walks away believing they told the shop they hold an enriched-air
  // card, which is the same broken promise as asking a question and discarding
  // the answer (ADR 20260814-self-declared-cards).
  const [answer, setAnswer] = useState("");
  const [nitrox, setNitrox] = useState(false);
  const uncertified = answer === NO_CERTIFICATION_ANSWER;
  return (
    // A self-contained block with its own grid, dropped in *beside* each form's
    // existing `FieldGrid` rather than into it: a `Field` is a two-row subgrid
    // item and the checkbox is not, so mixing them into a caller's grid knocks
    // every field after them half a row out of step — the staircase the
    // last-minute form's own spacer comment already records.
    <div className="flex flex-col gap-3">
      <FieldGrid columns={2}>
        <DiveCertificationField answer={answer} onAnswerChange={setAnswer} />
      </FieldGrid>
      {/* Nitrox stays on the trip-specific wait list, where a diver is naming
          what they want from that departure. The shop-wide deal list does not
          collect it: that list is a broad interest signal, and a public tick
          must never look like certification evidence. */}
      {showNitrox ? (
        <label className={`flex items-start gap-2 text-sm${uncertified ? " text-muted" : ""}`}>
          <input
            type="checkbox"
            name="nitroxCertified"
            value="on"
            disabled={uncertified}
            checked={nitrox && !uncertified}
            onChange={(event) => setNitrox(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-border-strong disabled:opacity-50"
          />
          <span>{t("common.certification.nitrox")}</span>
        </label>
      ) : null}
    </div>
  );
}

/**
 * The level field shared by the broad deal list, the trip wait lists, and —
 * once per diver — the booking form's party fieldsets.
 *
 * `name` is a parameter because the booking form asks this of up to six people
 * at once and each answer has to arrive separately (`certificationLevel-0`…).
 * The two wait lists ask one person and keep the bare name.
 */
export function DiveCertificationField({
  answer,
  onAnswerChange,
  name = "certificationLevel",
  belowRequirement,
}: {
  answer?: string;
  onAnswerChange?: (value: string) => void;
  name?: string;
  /**
   * Shown under the select when this diver's own answer ranks below what the
   * departure asks for. **A warning, never a stop** — the seat is still theirs
   * to buy (product owner, 2026-08-20, closing
   * FU-20260820-the-sale-gate-bites-only-the-honest). Absent on the wait lists,
   * which gate on nothing.
   */
  belowRequirement?: string | null;
}) {
  const t = useTranslations();
  return (
    <Field
      label={t("common.certification.level")}
      hint={t("common.optional")}
      description={
        // `role="status"` because the sentence appears *while the select still
        // has focus* — a bare `aria-describedby` string is not announced when
        // it materialises under the control the reader is already on, so the
        // sighted diver would see it and the screen-reader diver would not.
        // Polite rather than an alert: nothing is wrong, and it must not
        // interrupt the reader mid-option.
        //
        // Rendered only when there is something to say. A party of six would
        // otherwise put six empty live regions on the page, which is six things
        // for a screen reader to track and nothing for it to read
        // (`sourcery-ai`).
        belowRequirement ? (
          <span role="status" aria-live="polite" className="text-sm text-warning-strong">
            {belowRequirement}
          </span>
        ) : undefined
      }
      aside={
        <InfoHint
          label={t("common.certification.levelInfoLabel")}
          detail={t("common.certification.levelDescription")}
        />
      }
    >
      <select
        name={name}
        {...(answer === undefined
          ? { defaultValue: "" }
          : {
              value: answer,
              onChange: (event) => onAnswerChange?.(event.target.value),
            })}
        className={controlClass}
      >
        <option value="">{t("common.certification.levelUnsaid")}</option>
        <option value={NO_CERTIFICATION_ANSWER}>{t("common.certification.levelNone")}</option>
        {Object.entries(DIVER_CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
          <option key={value} value={value}>
            {t(key)}
          </option>
        ))}
      </select>
    </Field>
  );
}
