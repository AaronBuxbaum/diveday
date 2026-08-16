"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InfoHint } from "@/components/ui/InfoHint";
import { DIVER_CERTIFICATION_LEVEL_KEYS } from "@/i18n/readiness-labels";
import { NO_CERTIFICATION_ANSWER } from "@/lib/dive-declaration";

/**
 * **"What can you dive?", asked once, on both of the lists that ask a diver to
 * wait for something.** The shared level question informs staff; the optional
 * nitrox declaration is available only on a trip-specific wait list.
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
        <Field
          label={t("common.certification.level")}
          hint={t("common.optional")}
          aside={
            <InfoHint
              label={t("common.certification.levelInfoLabel")}
              detail={t("common.certification.levelDescription")}
            />
          }
        >
          <select
            name="certificationLevel"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            className={controlClass}
          >
            {/* First and pre-selected: skipping is the default, not something
                the diver has to go back and choose. */}
            <option value="">{t("common.certification.levelUnsaid")}</option>
            {/* **An honest answer for the joiner who holds no card**, and the
                one this list was missing: Discover Scuba and Try Scuba
                customers, snorkellers, the non-diving half of a couple. Their
                only option used to be "Rather not say", which reads to staff
                exactly like a certified regular who skipped the question — so
                the shop mailed them a certified two-tank charter.

                Above the ladder rather than below it, so the whole select reads
                in one direction: no card, then the rungs in order. Its value is
                deliberately not a `CertificationLevel` — it lands as a stamp on
                the person and never as a certification row, because a Discover
                Scuba experience is not one (ADR 20260814-self-declared-cards). */}
            <option value={NO_CERTIFICATION_ANSWER}>{t("common.certification.levelNone")}</option>
            {Object.entries(DIVER_CERTIFICATION_LEVEL_KEYS).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </Field>
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
