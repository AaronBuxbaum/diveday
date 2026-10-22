import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { numbersCameFrom, VOICE_RULES } from "./facts";

/**
 * **bench**: the technician's bench notes on a work order become the short
 * "What was done" line the customer is told at pickup ("New mouthpiece and a
 * full service; second stage was free-flowing"). It lands in that box for the
 * staffer to edit; staff send the ready message as today. A number the notes
 * do not hold is refused.
 */

export const BENCH_NOTE_FEATURE = "bench_note";
export const BENCH_NOTE_MAX = 1_000;

export const BENCH_NOTE_SYSTEM = [
  "A dive shop technician's bench notes on a customer's gear service become one or two plain sentences telling the customer what was done and anything they should know.",
  "Use only what the notes say. Leave out prices, internal shop talk and the technician's name. Keep any number exactly as written.",
  VOICE_RULES,
].join("\n");

const Note = z.object({ message: z.string() });

export type BenchInput = {
  readonly reportedProblem: string;
  readonly technicianNotes: string;
  /** The outcome code (`serviced`, `repaired`, …) when recorded. */
  readonly outcome: string | null;
  readonly locale: string;
};

export function benchNoteCall(input: BenchInput): StructuredCall<typeof Note> {
  return {
    model: "quick",
    system: BENCH_NOTE_SYSTEM,
    content: JSON.stringify({
      language: input.locale.toLowerCase().startsWith("es")
        ? "Latin American Spanish"
        : "English (United States)",
      customerSaid: input.reportedProblem,
      benchNotes: input.technicianNotes,
      outcome: input.outcome,
    }),
    schema: Note,
    maxTokens: 500,
  };
}

export function benchNote(value: { message: string } | null, input: BenchInput): string | null {
  const message = value?.message.trim() ?? "";
  if (!message || message.length > BENCH_NOTE_MAX) return null;
  return numbersCameFrom(message, `${input.reportedProblem} ${input.technicianNotes}`)
    ? message
    : null;
}

export function benchNoteFixture(): unknown {
  return {
    // i18n-exempt: a canned model answer for the browser fleet (e2e-fixtures.ts), never DiveDay copy
    message: "New mouthpiece and a full service. The second stage was free-flowing and is fixed.",
  };
}
