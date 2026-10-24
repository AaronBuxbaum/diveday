import { FieldGrid } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { MedicalAlertBox } from "./MedicalAlertBox";
import { SectionHeading } from "./SectionHeading";

/** The box's id: what a refusal rings and `WAIVER_FIELD_ERROR.medicalAlert` names. */
export const MEDICAL_ALERT_ANCHOR = "medicalAlert";

/**
 * **"For the crew, in an emergency"** (glossary *Medical alert for the
 * crew*, issue #2960): one optional box, right after the standard medical
 * questionnaire, for what the boat should know if something goes wrong.
 *
 * It is not a step on the rail (optional, one field) and nothing counts it
 * toward the medical step; the questionnaire alone refers a diver to a doctor.
 * Since the visual review of 2026-10-24 (B56) it carries one helper sentence,
 * the first: what to write, and to leave it blank if there is nothing (a bare
 * "N/A" is stored as none anyway). On a minor's release it names the diver,
 * since a guardian is typing.
 *
 * The box starts from the link's own draft. With none, and when the same
 * person's latest signed release here carried an alert, it says so and asks
 * them to write it again if it still applies (`medicalAlertPrefill`), so
 * signing again never drops an alert unseen. Never the earlier words: the
 * link is a bearer capability (H-153, security review 2, L-1).
 */
export function MedicalAlertSection({
  prefill,
  minorName,
  error,
  t,
}: {
  /** What the box starts with (`medicalAlertPrefill`): the link's draft, and whether the last release here had an alert. */
  prefill: { draft: string | null; earlierAlert: boolean };
  /** The diver's name on a minor's release, where a guardian is writing about them. */
  minorName: string | null;
  /** The words for a refused box, shown beside it. */
  error: string | undefined;
  t: DiverTranslator;
}) {
  return (
    <section>
      <SectionHeading>{t("waiver.medicalAlertHeading")}</SectionHeading>
      <p className="mt-2 text-sm text-muted">
        {minorName
          ? t("waiver.medicalAlertIntroMinor", { name: minorName })
          : t("waiver.medicalAlertIntro")}
      </p>
      {prefill.earlierAlert ? (
        <p className="mt-3 text-sm font-medium">{t("waiver.medicalAlertEarlier")}</p>
      ) : null}
      <FieldGrid columns={1} className="mt-4">
        <MedicalAlertBox
          id={MEDICAL_ALERT_ANCHOR}
          label={t("waiver.medicalAlertLabel")}
          hint={t("common.optional")}
          error={error}
          defaultValue={prefill.draft ?? ""}
          counter={{
            one: t.raw("waiver.medicalAlertCounterOne"),
            other: t.raw("waiver.medicalAlertCounterOther"),
          }}
        />
      </FieldGrid>
    </section>
  );
}
