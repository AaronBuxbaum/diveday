import type { MedicalAnswers, MedicalJurisdiction } from "@/db/schema";

/**
 * The diver medical questionnaire — the RSTC/WRSTC "Diver Medical" model and a
 * UK variant. A questionnaire is versioned data, not free text: a completed
 * waiver stores the questionnaire id + version it was answered against, so a
 * later edit to the question set never re-interprets signed evidence.
 *
 * Physician-referral is the blocking state, never a checkbox: a `referral`
 * question answered "yes" means a doctor must clear the diver before boarding.
 */
export type MedicalQuestion = {
  id: string;
  prompt: string;
  /** A "yes" here requires a physician's written clearance before diving. */
  referral: boolean;
};

export type MedicalQuestionnaire = {
  id: string;
  version: number;
  jurisdiction: MedicalJurisdiction;
  title: string;
  intro: string;
  questions: readonly MedicalQuestion[];
};

/** RSTC/WRSTC Diver Medical — the default in the US and much of the world. */
export const RSTC_QUESTIONNAIRE: MedicalQuestionnaire = {
  id: "rstc",
  version: 1,
  jurisdiction: "rstc",
  title: "RSTC Diver Medical",
  intro:
    "The recreational scuba standard. A “yes” to any question means a physician should review your fitness to dive before the trip — it doesn’t automatically cancel your dive.",
  questions: [
    {
      id: "heart_lung",
      prompt:
        "Do you have, or have you had, a heart, lung, or breathing condition (including asthma) affecting exercise?",
      referral: true,
    },
    {
      id: "blood_pressure",
      prompt:
        "Do you take medication for, or have you been treated for, blood pressure or heart disease?",
      referral: true,
    },
    {
      id: "recent_surgery",
      prompt: "Have you had surgery, a serious injury, or been hospitalized in the last 12 months?",
      referral: true,
    },
    {
      id: "medication",
      prompt:
        "Are you taking prescription medication (other than birth control or anti-malarials)?",
      referral: true,
    },
    {
      id: "ear_sinus",
      prompt:
        "Do you have recurring ear, sinus, or equalizing problems, or have you had ear surgery?",
      referral: true,
    },
    {
      id: "diabetes_seizure",
      prompt: "Do you have diabetes, epilepsy, seizures, fainting, or a neurological condition?",
      referral: true,
    },
    {
      id: "pregnancy",
      prompt: "Are you pregnant, or trying to become pregnant?",
      referral: true,
    },
    {
      id: "recent_illness",
      prompt:
        "Have you recently been ill (cold, flu, congestion) in a way that could affect diving?",
      referral: true,
    },
  ],
};

/** A shorter UK-style self-declaration (UKDMC/BSAC lineage). */
export const UK_QUESTIONNAIRE: MedicalQuestionnaire = {
  id: "uk",
  version: 1,
  jurisdiction: "uk",
  title: "UK Diver Medical Self-Declaration",
  intro:
    "The UK sport-diving self-declaration. A “yes” to any question means a diving doctor should confirm your fitness to dive before the trip.",
  questions: [
    {
      id: "heart_lung",
      prompt:
        "Do you have any heart, chest, or lung condition, including asthma treated in the last 5 years?",
      referral: true,
    },
    {
      id: "ent",
      prompt: "Do you have any ear, nose, throat, or sinus condition, or trouble equalizing?",
      referral: true,
    },
    {
      id: "neuro",
      prompt: "Have you had blackouts, fits, migraine, or any neurological condition?",
      referral: true,
    },
    {
      id: "medication",
      prompt:
        "Are you taking any regular medication, or have a condition needing ongoing treatment?",
      referral: true,
    },
    {
      id: "recent",
      prompt: "Have you been unwell, injured, or had surgery in the last 4 weeks?",
      referral: true,
    },
    {
      id: "pregnancy",
      prompt: "Are you pregnant, or trying to become pregnant?",
      referral: true,
    },
  ],
};

const QUESTIONNAIRES: readonly MedicalQuestionnaire[] = [RSTC_QUESTIONNAIRE, UK_QUESTIONNAIRE];

const BY_JURISDICTION: Record<MedicalJurisdiction, MedicalQuestionnaire> = {
  rstc: RSTC_QUESTIONNAIRE,
  uk: UK_QUESTIONNAIRE,
};

const BY_ID = new Map(QUESTIONNAIRES.map((q) => [q.id, q]));

export const MEDICAL_JURISDICTION_LABELS: Record<MedicalJurisdiction, string> = {
  rstc: "RSTC (US / international)",
  uk: "United Kingdom",
};

/** The questionnaire a shop presents, driven by its jurisdiction. */
export function questionnaireForJurisdiction(
  jurisdiction: MedicalJurisdiction,
): MedicalQuestionnaire {
  return BY_JURISDICTION[jurisdiction] ?? RSTC_QUESTIONNAIRE;
}

/** Look up the questionnaire a stored answer was captured against. */
export function findQuestionnaire(id: string): MedicalQuestionnaire | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Physician review is required when any referral-flagged question was answered
 * "yes". Fails closed: an unknown questionnaire or an unrecognized question id
 * that was answered "yes" is treated as needing review, never waved through.
 */
export function needsPhysicianReview(answers: MedicalAnswers): boolean {
  const questionnaire = BY_ID.get(answers.questionnaireId);
  const referralById = new Map(questionnaire?.questions.map((q) => [q.id, q.referral]));
  return Object.entries(answers.responses).some(([id, yes]) => {
    if (!yes) return false;
    return referralById.get(id) ?? true;
  });
}

/** The prompts a diver answered "yes" to — what a staff reviewer must check. */
export function flaggedMedicalPrompts(answers: MedicalAnswers): string[] {
  const questionnaire = BY_ID.get(answers.questionnaireId);
  const byId = new Map(questionnaire?.questions.map((q) => [q.id, q]));
  return Object.entries(answers.responses)
    .filter(([, yes]) => yes)
    .map(([id]) => byId.get(id)?.prompt ?? "An unrecognized medical question was answered yes");
}

/** An all-"no" answer set for a questionnaire — the baseline a diver edits. */
export function emptyMedicalAnswers(questionnaire: MedicalQuestionnaire): MedicalAnswers {
  return {
    questionnaireId: questionnaire.id,
    questionnaireVersion: questionnaire.version,
    responses: Object.fromEntries(questionnaire.questions.map((q) => [q.id, false])),
  };
}
