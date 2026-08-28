// i18n-exempt-file: the participant questionnaire is safety/legal wording from
// the published UHMS/DMSC form and stays English pending H-01/H-03 sign-off.
import type { MedicalAnswers, MedicalJurisdiction } from "@/db/schema";

export type MedicalQuestionSection =
  | "primary"
  | "box_a"
  | "box_b"
  | "box_c"
  | "box_d"
  | "box_e"
  | "box_f"
  | "box_g"
  | "dental";

export type MedicalQuestion = {
  id: string;
  prompt: string;
  section: MedicalQuestionSection;
  /** The primary question which makes this Box applicable when answered yes. */
  parentId?: string;
  /** Box opened by a primary question; present only on primary questions. */
  boxSection?: Exclude<MedicalQuestionSection, "primary" | "dental">;
  /** A yes answer requires physician evaluation under the published directions. */
  referral: boolean;
};

export type MedicalQuestionnaire = {
  id: string;
  version: number;
  jurisdiction: MedicalJurisdiction;
  title: string;
  intro: string;
  questions: readonly MedicalQuestion[];
  boxes?: readonly {
    section: Exclude<MedicalQuestionSection, "primary" | "dental">;
    title: string;
  }[];
};

const primary = (
  id: string,
  prompt: string,
  boxSection?: Exclude<MedicalQuestionSection, "primary" | "dental">,
): MedicalQuestion => ({
  id,
  prompt,
  section: "primary",
  ...(boxSection ? { boxSection } : {}),
  referral: !boxSection,
});

const box = (
  section: Exclude<MedicalQuestionSection, "primary" | "dental">,
  parentId: string,
  number: number,
  prompt: string,
): MedicalQuestion => ({
  id: `${section}_${number}`,
  prompt,
  section,
  parentId,
  referral: true,
});

/**
 * Version 3 is the 2026-01-01 Diver Medical Participant Questionnaire
 * published by UHMS/DMSC. A primary yes is not itself a referral unless the
 * form marks it with an asterisk (questions 3, 5 and 10); it opens the
 * corresponding Box, whose yes answers are referrals.
 *
 * **Transcribed from the published PDF on 2026-08-20**, product 10346 EN,
 * version date 2026-01-01, sha256
 * `a02cbc5e415a2882cfa2df47b081e2e123ef208c55c3e3bf1b9e26e6a417e960`. Checked
 * question by question against pages 1-2; boxes A, B, D, E, F and G matched
 * what v2 already held, and the dental item did not — see
 * `RSTC_QUESTIONNAIRE_V2` below for what it got wrong and why the version
 * moved rather than the row.
 */
export const RSTC_QUESTIONNAIRE: MedicalQuestionnaire = {
  id: "rstc",
  version: 3,
  jurisdiction: "rstc",
  title: "Diver Medical | Participant Questionnaire",
  intro:
    "Answer all 10 questions. If you answer NO to all 10, a medical evaluation is not required. A YES to questions 3, 5 or 10, or to any question in an applicable Box, requires physician evaluation.",
  questions: [
    primary(
      "q1",
      "I have had problems with my lungs, breathing, heart and/or blood affecting my normal physical or mental performance.",
      "box_a",
    ),
    primary("q2", "I am over 45 years of age.", "box_b"),
    primary(
      "q3",
      "I struggle to perform moderate exercise (for example, walk 1.6 kilometer/one mile in 14 minutes or swim 200 meters/yards without resting), or I have been unable to participate in a normal physical activity due to fitness or health reasons within the past 12 months.",
    ),
    primary(
      "q4",
      "I have had problems with my eyes, ears, or nasal passages/sinuses or teeth.",
      "box_c",
    ),
    primary(
      "q5",
      "I have had surgery within the last 12 months, or I have ongoing problems related to past surgery.",
    ),
    primary(
      "q6",
      "I have lost consciousness, had migraine headaches, seizures, stroke, significant head injury, or suffer from persistent neurologic injury or disease. I have a condition where sudden neurological compromise/impairment is possible.",
      "box_d",
    ),
    primary(
      "q7",
      "I am currently undergoing treatment (or have required treatment within the past five years) for psychological problems, personality disorder, panic attacks, or an addiction to drugs or alcohol; or, I have been diagnosed with a learning or developmental disability.",
      "box_e",
    ),
    primary("q8", "I have had back problems, hernia, ulcers, or diabetes.", "box_f"),
    primary("q9", "I have had stomach or intestine problems, including recent diarrhea.", "box_g"),
    primary(
      "q10",
      "I am currently taking one or more prescription medications. (This need not include birth control, menopausal hormone replacement, and antimalarial medication unless it is mefloquine [Lariam].)",
    ),

    box(
      "box_a",
      "q1",
      1,
      "Chest surgery, heart surgery, heart valve surgery, an implantable medical device (e.g., stent, pacemaker, neurostimulator), pneumothorax, and/or chronic lung disease.",
    ),
    box(
      "box_a",
      "q1",
      2,
      "Asthma, wheezing, severe allergies, hay fever or congested airways within the last 12 months that limits my physical activity/exercise.",
    ),
    box(
      "box_a",
      "q1",
      3,
      "A problem or illness involving my heart such as angina, chest pain on exertion, heart failure, immersion pulmonary edema, heart attack or stroke, or am taking medication for any heart condition.",
    ),
    box(
      "box_a",
      "q1",
      4,
      "Recurrent bronchitis and currently coughing within the past 12 months, or have been diagnosed with emphysema.",
    ),
    box(
      "box_a",
      "q1",
      5,
      "Symptoms affecting my lungs, breathing, heart and/or blood in the last 30 days that impair my physical or mental performance.",
    ),

    box("box_b", "q2", 1, "I currently smoke or inhale nicotine by other means."),
    box("box_b", "q2", 2, "I have a high cholesterol level."),
    box("box_b", "q2", 3, "I have high blood pressure."),
    box(
      "box_b",
      "q2",
      4,
      "I have had a close blood relative die suddenly or of cardiac disease or stroke before the age of 50, or have a family history of heart disease before age 50 (including abnormal heart rhythms, coronary artery disease or cardiomyopathy).",
    ),

    box("box_c", "q4", 1, "Sinus surgery within the last 6 months."),
    box("box_c", "q4", 2, "Ear disease or ear surgery, hearing loss, or problems with balance."),
    box("box_c", "q4", 3, "Recurrent sinusitis within the past 12 months."),
    box("box_c", "q4", 4, "Eye surgery within the past 3 months."),
    box("box_c", "q4", 5, "Still healing / recovering from recent dental / oral procedure."),

    box("box_d", "q6", 1, "Head injury with loss of consciousness within the past 5 years."),
    box(
      "box_d",
      "q6",
      2,
      "Persistent neurologic injury or disease, to include episodic and/or unpredictable loss, reduction, or change in neurological, cognitive, or motor function or performance.",
    ),
    box(
      "box_d",
      "q6",
      3,
      "Recurring migraine headaches within the past 12 months, or take medications to prevent them.",
    ),
    box(
      "box_d",
      "q6",
      4,
      "Blackouts or fainting (full/partial loss of consciousness) within the last 5 years.",
    ),
    box(
      "box_d",
      "q6",
      5,
      "Epilepsy, seizures, or convulsions, or take medications to prevent them.",
    ),

    box(
      "box_e",
      "q7",
      1,
      "Behavioral health, mental, or psychological problems requiring medical/psychiatric treatment.",
    ),
    box(
      "box_e",
      "q7",
      2,
      "Major depression, suicidal ideation, panic attacks, uncontrolled bipolar disorder requiring medication/psychiatric treatment.",
    ),
    box(
      "box_e",
      "q7",
      3,
      "Been diagnosed with a mental health condition or a learning/developmental disorder that requires ongoing care or special accommodation.",
    ),
    box(
      "box_e",
      "q7",
      4,
      "An addiction to drugs or alcohol requiring treatment within the last 5 years.",
    ),

    box(
      "box_f",
      "q8",
      1,
      "Recurrent back problems in the last 6 months that limit my everyday activity.",
    ),
    box("box_f", "q8", 2, "Back or spinal surgery within the last 12 months."),
    box(
      "box_f",
      "q8",
      3,
      "Diabetes, either drug or diet controlled, or gestational diabetes within the last 12 months.",
    ),
    box("box_f", "q8", 4, "An uncorrected hernia that limits my physical abilities."),
    box(
      "box_f",
      "q8",
      5,
      "Active or untreated ulcers, problem wounds, or ulcer surgery within the last 6 months.",
    ),

    box(
      "box_g",
      "q9",
      1,
      "Ostomy surgery and do not have medical clearance to swim or engage in physical activity.",
    ),
    box("box_g", "q9", 2, "Dehydration requiring medical intervention within the last 7 days."),
    box(
      "box_g",
      "q9",
      3,
      "Active or untreated stomach or intestinal ulcers or ulcer surgery within the last 6 months.",
    ),
    box(
      "box_g",
      "q9",
      4,
      "Frequent heartburn, regurgitation, or gastroesophageal reflux disease (GERD).",
    ),
    box("box_g", "q9", 5, "Active or uncontrolled ulcerative colitis or Crohn's disease."),
    box("box_g", "q9", 6, "Bariatric surgery within the last 12 months."),
  ],
  boxes: [
    { section: "box_a", title: "BOX A - I HAVE/HAVE HAD:" },
    { section: "box_b", title: "BOX B - I AM OVER 45 YEARS OF AGE AND:" },
    { section: "box_c", title: "BOX C - I HAVE/HAVE HAD:" },
    { section: "box_d", title: "BOX D - I HAVE/HAVE HAD:" },
    { section: "box_e", title: "BOX E - I HAVE/HAVE HAD:" },
    { section: "box_f", title: "BOX F - I HAVE/HAVE HAD:" },
    { section: "box_g", title: "BOX G - I HAVE HAD:" },
  ],
};

/**
 * **v2 got the dental item wrong, and is retained so no signed record is
 * re-read under the corrected rule.** It carried "still healing/recovering
 * from a recent dental/oral procedure" as a standalone question asked of
 * every diver. On the published form that sentence is the *fifth item of Box
 * C*, reached only by answering yes to question 4 (eyes/ears/sinuses/teeth) —
 * confirmed against the 2026-01-01 PDF on 2026-08-20.
 *
 * Retaining it is the whole point of stamping a version onto
 * `waiver_records.medical_answers` (ADR 20260805-rstc-medical-questionnaire).
 * A v2 record answering `q4: false, dental_recovery: true` is a diver who
 * declared a healing extraction and was sent to a physician. Read under v3's
 * question set that answer is not applicable, `calculateMedicalResult` returns
 * `clear`, and the boarding hold in `certificationBlocker`'s sibling
 * `medical_review` branch lifts — silently, with no migration and no failing
 * test. So v2 stays for as long as a v2 record can exist, and only the
 * *current* questionnaire is ever rendered to a diver.
 *
 * Everything except that one question is identical to v3, and it is spelled as
 * a transformation rather than a second copy of the legal prose so the two
 * versions cannot drift in any other respect.
 *
 * **Why this survives where the v1 paraphrase did not** (deleted the same day
 * by the H-49 "there is no legacy" pass): v1 was wording DiveDay invented and
 * no published form ever carried, so nothing could ever need it to read a
 * record honestly. v2 *is* the published form as it stood, and this is the
 * first time the version pin ADR 20260805 promises has had to do its job. The
 * mechanism is worth more than the twelve lines it costs — and a correction to
 * v3 will want the same precedent.
 */
const RSTC_QUESTIONNAIRE_V2: MedicalQuestionnaire = {
  ...RSTC_QUESTIONNAIRE,
  version: 2,
  intro:
    "Answer all 10 questions. If you answer NO to all 10, a medical evaluation is not required. A YES to questions 3, 5 or 10, or to any question in an applicable Box or the dental question, requires physician evaluation.",
  questions: RSTC_QUESTIONNAIRE.questions.map((question) =>
    question.id === "box_c_5"
      ? {
          id: "dental_recovery",
          prompt: "Still healing/recovering from a recent dental/oral procedure.",
          section: "dental" as const,
          referral: true,
        }
      : question,
  ),
};

const CURRENT_QUESTIONNAIRES: readonly MedicalQuestionnaire[] = [RSTC_QUESTIONNAIRE];
const BY_KEY = new Map(
  [RSTC_QUESTIONNAIRE, RSTC_QUESTIONNAIRE_V2].map((q) => [`${q.id}:${q.version}`, q]),
);

/**
 * Not a lookup yet: every jurisdiction — including the `uk` value the schema
 * enum carries — currently falls back to the RSTC questionnaire, because no UK
 * questionnaire has been written (that wording is a sign-off decision, H-03).
 * The argument is accepted so call sites don't change when one lands.
 */
export function questionnaireForJurisdiction(
  _jurisdiction: MedicalJurisdiction,
): MedicalQuestionnaire {
  return CURRENT_QUESTIONNAIRES[0] ?? RSTC_QUESTIONNAIRE;
}

export function findQuestionnaireVersion(id: string, version: number): MedicalQuestionnaire | null {
  return BY_KEY.get(`${id}:${version}`) ?? null;
}

/**
 * The prefix every question's form field carries, and the field name itself.
 *
 * One spelling, because four readers depend on it and none of them can see the
 * others: `MedicalQuestionnaireFields` renders the radios, the waiver page
 * reads the submitted form back through it, `WaiverPacing`'s delegated listener
 * matches on the prefix, and the same page seeds that listener from a saved
 * draft. A rename in one of those alone is silent — the count simply stops
 * moving.
 */
export const MEDICAL_FIELD_PREFIX = "q_";

export function medicalQuestionField(questionId: string): string {
  return `${MEDICAL_FIELD_PREFIX}${questionId}`;
}

export function applicableMedicalQuestions(
  questionnaire: MedicalQuestionnaire,
  responses: Readonly<Record<string, boolean | undefined>>,
): MedicalQuestion[] {
  return questionnaire.questions.filter(
    (question) => !question.parentId || responses[question.parentId] === true,
  );
}

/**
 * Where a half-filled questionnaire stands, for the diver filling it in.
 *
 * The published form opens with its own directions — "answer all 10; a NO to
 * all 10 means no medical evaluation; a YES to 3, 5 or 10, or to any Box
 * question or the dental one, requires physician evaluation". That is a rule a
 * diver has to hold in their head across forty questions and then apply to
 * themselves, and the 2026-08-06 review found it did the opposite of
 * reassuring. This derives the same conclusion from the answers as they are
 * given, so the page can state the outcome at the moment it becomes true
 * instead of asking the reader to compute it.
 *
 * `referral` is decisive and monotonic: one applicable yes on a
 * referral-marked question means physician sign-off no matter what else is
 * answered afterwards, so it is reported as soon as it happens rather than
 * held back until the form is complete. It is the same rule
 * `calculateMedicalResult` records — this one just does not require a complete
 * form to say what it already knows, and never returns a status of record.
 *
 * Counts are over *applicable* questions only: a Box that no answer has opened
 * is not something the diver has left to do.
 */
export type MedicalProgress = {
  /** Applicable questions answered either way. */
  answered: number;
  /** Applicable questions in total, so `answered`/`total` is the honest ratio. */
  total: number;
  /** Applicable questions still blank. */
  remaining: number;
  /** Primary (page-one) questions still blank — what the progress bar counts. */
  primaryRemaining: number;
  outcome:
    | /** Nothing answered yet — there is nothing true to say. */ "unanswered"
    | /** Underway, and no referral answer so far. */ "in_progress"
    | /** Every primary answered, but an opened Box or the dental check is not. */ "follow_ups_open"
    | /** An applicable referral answer is yes: a physician has to sign off. */ "referral"
    | /** Every applicable question answered, none of them a referral. */ "clear";
};

export function medicalProgress(
  questionnaire: MedicalQuestionnaire,
  responses: Readonly<Record<string, boolean | undefined>>,
): MedicalProgress {
  const applicable = applicableMedicalQuestions(questionnaire, responses);
  const isAnswered = (question: MedicalQuestion) => typeof responses[question.id] === "boolean";
  const answered = applicable.filter(isAnswered).length;
  const remaining = applicable.length - answered;
  const primaryRemaining = applicable.filter(
    (question) => question.section === "primary" && !isAnswered(question),
  ).length;
  const flagged = applicable.some(
    (question) => question.referral && responses[question.id] === true,
  );
  const outcome: MedicalProgress["outcome"] = flagged
    ? "referral"
    : remaining === 0
      ? "clear"
      : answered === 0
        ? "unanswered"
        : primaryRemaining === 0
          ? "follow_ups_open"
          : "in_progress";
  return { answered, total: applicable.length, remaining, primaryRemaining, outcome };
}

export type MedicalResult =
  | { status: "clear"; flaggedQuestionIds: []; flaggedPrompts: [] }
  | { status: "physician_review"; flaggedQuestionIds: string[]; flaggedPrompts: string[] }
  | { status: "incomplete"; missingQuestionIds: string[] };

/** Validate the exact questionnaire version before deriving a result. */
export function validateMedicalAnswers(
  answers: MedicalAnswers,
  options: { requireComplete?: boolean; requireCurrent?: boolean } = {},
): { ok: true; questionnaire: MedicalQuestionnaire } | { ok: false; missingQuestionIds: string[] } {
  const questionnaire = findQuestionnaireVersion(
    answers.questionnaireId,
    answers.questionnaireVersion,
  );
  if (!questionnaire) return { ok: false, missingQuestionIds: ["questionnaire"] };
  // **Readable is not the same as signable.** A retired version stays in
  // `BY_KEY` so a *stored* record can still be interpreted honestly; it must
  // never be a set of questions somebody can sign *today*, or a corrected form
  // could be answered under the version it corrected. `completeWaiver` passes
  // this; every read path deliberately does not.
  if (options.requireCurrent && !CURRENT_QUESTIONNAIRES.includes(questionnaire)) {
    return { ok: false, missingQuestionIds: ["questionnaire"] };
  }
  const responseKeys = new Set(Object.keys(answers.responses));
  if ([...responseKeys].some((id) => !questionnaire.questions.some((q) => q.id === id))) {
    return { ok: false, missingQuestionIds: ["questionnaire"] };
  }
  const applicable = applicableMedicalQuestions(questionnaire, answers.responses);
  const missing = options.requireComplete
    ? applicable
        .filter((question) => typeof answers.responses[question.id] !== "boolean")
        .map((q) => q.id)
    : [];
  return missing.length ? { ok: false, missingQuestionIds: missing } : { ok: true, questionnaire };
}

/** Calculate the published form's outcome. Incomplete input fails closed. */
export function calculateMedicalResult(answers: MedicalAnswers): MedicalResult {
  const validated = validateMedicalAnswers(answers, { requireComplete: true });
  if (!validated.ok)
    return { status: "incomplete", missingQuestionIds: validated.missingQuestionIds };
  const flagged = applicableMedicalQuestions(validated.questionnaire, answers.responses).filter(
    (question) => answers.responses[question.id] === true && question.referral,
  );
  if (!flagged.length) return { status: "clear", flaggedQuestionIds: [], flaggedPrompts: [] };
  return {
    status: "physician_review",
    flaggedQuestionIds: flagged.map((question) => question.id),
    flaggedPrompts: flagged.map((question) => question.prompt),
  };
}

/** Any applicable referral answer requires physician review; unknown/incomplete fails closed. */
export function needsPhysicianReview(answers: MedicalAnswers): boolean {
  return calculateMedicalResult(answers).status !== "clear";
}

export function flaggedMedicalPrompts(answers: MedicalAnswers): string[] {
  const result = calculateMedicalResult(answers);
  if (result.status === "physician_review") return result.flaggedPrompts;
  if (result.status === "incomplete")
    return ["An incomplete or unrecognized medical questionnaire requires review"];
  return [];
}

export function emptyMedicalAnswers(questionnaire: MedicalQuestionnaire): MedicalAnswers {
  return {
    questionnaireId: questionnaire.id,
    questionnaireVersion: questionnaire.version,
    responses: Object.fromEntries(questionnaire.questions.map((question) => [question.id, false])),
  };
}
