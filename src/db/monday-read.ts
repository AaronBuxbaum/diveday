import {
  MONDAY_READ_FEATURE,
  type MondaySentence,
  mondayRead,
  mondayReadCall,
  mondaySectionFacts,
} from "@/lib/assists/monday-read";
import { sourceDigest } from "@/lib/assists/shop-translate";
import type { WeeklyDigestEmailSection } from "@/lib/notifications/kinds";
import { readAssistResult, saveAssistResult } from "./assist-results";
import { type AssistOptions, runAssistOutcome } from "./assists";
import type { AppDb } from "./client";

/**
 * **monday**: the Monday email's opening sentences, written once per shop,
 * week, grade and language and kept in `assist_results`, so every recipient
 * of the same email reads the same words and an hourly pass asks once.
 *
 * Only the digest's own counts go out (`mondaySectionFacts`), never a name or
 * a booking. A dark assist, a refused answer or a week with no sections reads
 * as no sentences, and the email is the one it always was.
 */
export async function mondayReadFor(
  db: AppDb,
  input: {
    shopId: string;
    weekOf: string;
    grade: string;
    locale: string;
    sections: readonly WeeklyDigestEmailSection[];
  },
  options: AssistOptions = {},
): Promise<MondaySentence[]> {
  if (input.sections.length === 0) return [];
  const sections = input.sections.map((section) => mondaySectionFacts(section, input.locale));
  const subjectKey = `${input.weekOf}:${input.grade}:${input.locale}`;
  const digest = sourceDigest(JSON.stringify(sections));
  const stored = await readAssistResult(db, input.shopId, MONDAY_READ_FEATURE, subjectKey);
  if (stored && stored.inputDigest === digest) {
    return mondayRead(stored.value as { sentences: MondaySentence[] } | null, sections);
  }
  const { status, value } = await runAssistOutcome(db, {
    ...options,
    shopId: input.shopId,
    feature: MONDAY_READ_FEATURE,
    call: mondayReadCall(sections, input.locale),
  });
  if (status === "skipped") return [];
  // A refused or unusable answer is stored as no sentences, so the hourly
  // pass asks once for this week, grade and language.
  const answer = value ?? { sentences: [] };
  await saveAssistResult(db, {
    shopId: input.shopId,
    feature: MONDAY_READ_FEATURE,
    subjectKey,
    value: answer,
    inputDigest: digest,
  });
  return mondayRead(answer, sections);
}
