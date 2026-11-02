import type { DiverTranslator } from "@/i18n/messages";
import type { MedicalQuestionnaire } from "@/lib/medical";
import { MedicalQuestionnaireFields } from "./MedicalQuestionnaireFields";
import { QuestionnaireProgress } from "./QuestionnaireProgress";
import { SectionHeading } from "./SectionHeading";

/**
 * **The medical questionnaire's section**: its heading, the sticky count of the
 * questions the diver was handed (`primaryQuestionCount`, never the follow-ups
 * their answers open), and the questions, pre-filled only from a draft saved
 * against this same questionnaire. The anchor is what a medical refusal's jump
 * link and the rail point at.
 */
export function MedicalQuestionnaireSection({
  questionnaire,
  draftResponses,
  primaryQuestionCount,
  t,
}: {
  questionnaire: MedicalQuestionnaire;
  draftResponses: Readonly<Record<string, boolean>> | undefined;
  primaryQuestionCount: number;
  t: DiverTranslator;
}) {
  return (
    <section id="medical-questionnaire">
      <QuestionnaireProgress
        total={primaryQuestionCount}
        labelTemplateOne={t.raw("waiver.questionsAnsweredOne")}
        labelTemplateOther={t.raw("waiver.questionsAnsweredOther")}
      >
        <SectionHeading>{questionnaire.title}</SectionHeading>
        {/* The published form's directions paragraph used to sit here. It
              asked the diver to memorise which question numbers carry an
              asterisk and then apply the rule to their own answers, which is
              work the page can do for them — `MedicalQuestionnaireFields`
              now states the outcome underneath the questions at the moment
              it becomes true (2026-08-06 review). The wording itself is
              unchanged and still on file in `RSTC_QUESTIONNAIRE.intro`; only
              where the diver meets it has moved. */}
        <MedicalQuestionnaireFields
          questionnaire={questionnaire}
          initialResponses={draftResponses}
          copy={{
            yesLabel: t("waiver.answerYes"),
            noLabel: t("waiver.answerNo"),
            referralReassurance: t("waiver.yesReassurance"),
            followUpReassurance: t("waiver.yesOpensFollowUps"),
            outcomeClear: t("waiver.outcomeClear"),
            outcomeReferral: t("waiver.outcomeReferral"),
            outcomeFollowUpsOpen: t("waiver.outcomeFollowUpsOpen"),
          }}
        />
      </QuestionnaireProgress>
    </section>
  );
}
