import type { DiveSiteDifficulty } from "@/lib/dive-site-difficulty";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * A dive site's difficulty is a code (`src/lib/dive-site-difficulty.ts`) — this
 * map is where it becomes a word in the diver's own language.
 *
 * The same shape `DiveSiteLandmarks` uses for a landmark's `kind`, and for the
 * same reason: the *reading* is DiveDay's — there are three of them and the app
 * decides what each is called — while everything the shop wants to say about
 * why this reef is easy or hard is its own prose, in `fit_note` and
 * `current_note`, which render exactly as typed.
 *
 * Until 2026-08-13 this was free text, and it was the one untranslated word on
 * a translated briefing: a Spanish page rendered "EXPERIENCIA / Beginner"
 * because the shop that typed it worked in English. `fit_tone` beside it had
 * been a code with a translated label since the day it shipped.
 */
const DIFFICULTY_KEYS: Record<DiveSiteDifficulty, DiverMessageKey> = {
  beginner: "site.difficulty.beginner",
  intermediate: "site.difficulty.intermediate",
  advanced: "site.difficulty.advanced",
};

/**
 * The word for a site's difficulty, or null when the shop has not said.
 *
 * Null is the ordinary case for a site nobody has finished writing, and every
 * caller falls back to "crew-led" rather than inventing a reading — the same
 * thing they did when the free-text field was empty.
 */
export function diveSiteDifficultyLabel(
  difficulty: DiveSiteDifficulty | null | undefined,
  t: DiverTranslator,
): string | null {
  return difficulty ? t(DIFFICULTY_KEYS[difficulty]) : null;
}
