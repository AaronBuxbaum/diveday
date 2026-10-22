import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { promptLanguage } from "./facts";

/**
 * **dupes**: for a pair the duplicate check is unsure about (one name, and no
 * email or phone agreeing, `matchRestsOnNameAlone`), Claude gives a
 * same-person-or-not read with its reasons. A staffer reads it beside the
 * side-by-side and decides; nothing here merges, and the merge form's own
 * "these are the same person" box is still the only way through.
 *
 * Personal data is minimised before it leaves: the name as written, the email's
 * local part and whether the domains agree, the phone's last four digits, the
 * birth date, the certification levels and the first and last month the shop
 * saw them. Never a full address, never a waiver or a medical answer.
 */

export const SAME_PERSON_FEATURE = "diver_dupes";

export type SamePersonRecord = {
  readonly fullName: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** `YYYY-MM-DD`. */
  readonly dateOfBirth: string | null;
  /** Level and specialty codes, as the record holds them. */
  readonly certifications: readonly string[];
  /** `YYYY-MM` of the first and the last departure, when there is one. */
  readonly firstSeen: string | null;
  readonly lastSeen: string | null;
};

export const SAME_PERSON_SYSTEM = [
  "Two diver records at one dive shop share a name and nothing that proves they are one person.",
  "Read both and say whether they are the same person: same, different, or unsure.",
  "Give at most three short reasons, each one fact from the records, in the language asked for. Do not repeat the name match itself as a reason.",
  "confidence is your own 0 to 1 estimate.",
].join("\n");

const Read = z.object({
  verdict: z.enum(["same", "different", "unsure"]),
  reasons: z.array(z.string()),
  confidence: z.number(),
});

function minimised(record: SamePersonRecord) {
  const [local, domain] = (record.email ?? "").toLowerCase().split("@");
  const digits = (record.phone ?? "").replace(/\D/g, "");
  return {
    name: record.fullName,
    emailLocalPart: local || null,
    emailDomain: domain || null,
    phoneLastFour: digits.length >= 4 ? digits.slice(-4) : null,
    dateOfBirth: record.dateOfBirth,
    certifications: record.certifications,
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
  };
}

export function samePersonCall(
  a: SamePersonRecord,
  b: SamePersonRecord,
  locale: string,
): StructuredCall<typeof Read> {
  const left = minimised(a);
  const right = minimised(b);
  const sameDomain = Boolean(left.emailDomain && left.emailDomain === right.emailDomain);
  return {
    model: "quick",
    system: SAME_PERSON_SYSTEM,
    content: JSON.stringify({
      language: promptLanguage(locale),
      recordA: { ...left, emailDomain: undefined },
      recordB: { ...right, emailDomain: undefined },
      emailDomainsAgree: sameDomain,
    }),
    schema: Read,
    maxTokens: 600,
    confidence: (value) => value.confidence,
  };
}

/** The read as a staffer sees it: a verdict code and up to three reasons. */
export function samePersonRead(
  value: z.infer<typeof Read> | null,
): { verdict: "same" | "different" | "unsure"; reasons: string[] } | null {
  if (!value) return null;
  const reasons = value.reasons
    .map((reason) => reason.trim())
    .filter((reason) => reason.length > 0 && reason.length <= 200)
    .slice(0, 3);
  return { verdict: value.verdict, reasons };
}

export function samePersonFixture(): unknown {
  return {
    verdict: "unsure",
    reasons: ["Only one record has a birth date.", "The two emails share a first name."],
    confidence: 0.7,
  };
}
