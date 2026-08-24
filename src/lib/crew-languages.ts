/**
 * The staff-side half of issue #708: a quiet signal when a trip's assigned
 * crew's recorded languages don't cover a booked diver's stated one — never a
 * gate, the same stance `divemaster-ratio.ts` takes on its own target.
 */

/**
 * Which of a trip's booked divers' languages nobody on the assigned crew has
 * recorded speaking.
 *
 * `dieverLanguages` is meant to be primary-subtag language codes (`"es"`, not
 * `"es-ES"`) drawn only from divers who gave a *first-hand* signal —
 * `people.locale` is null for anyone who never has, so a trip full of divers
 * with no stated preference correctly reports nothing rather than flagging
 * every crew that never recorded English.
 */
export function crewLanguageGap(input: {
  crewSpokenLanguages: readonly (readonly string[])[];
  diverLanguages: readonly string[];
}): { code: "none" } | { code: "uncovered"; missing: string[] } {
  const covered = new Set(input.crewSpokenLanguages.flat());
  const missing = [...new Set(input.diverLanguages)].filter((language) => !covered.has(language));
  return missing.length > 0 ? { code: "uncovered", missing } : { code: "none" };
}
