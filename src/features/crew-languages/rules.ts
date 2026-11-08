/**
 * The staff-side half of issue #708: a quiet signal when a trip's assigned
 * crew's recorded languages don't cover a booked diver's stated one — never a
 * gate, the same stance `divemaster-ratio.ts` takes on its own target.
 */

/** One language some of a departure's divers read, with who reads it and who aboard speaks it. */
export type LanguageBriefing = { language: string; divers: string[]; crew: string[] };

/**
 * **Name the divers, and who can brief them** (fifth-loop ideas, item 48):
 * "Ines Costa and Diego Alvarez booked in Spanish. No one on this crew has
 * recorded Spanish." or "Yusra Idrissi can brief Ines Costa and Diego Alvarez
 * in Spanish." Informs only, never a gate. Diver languages come only from a
 * first-hand signal (`people.locale`), so a boat of divers who never stated
 * one reports nothing rather than flagging every crew that never recorded
 * English.
 *
 * `uncovered` is every language nobody on the crew has recorded; `covered`
 * names the crew who speak it. Neither says the shop's own language, which
 * every briefing is already in and every crew member is taken to speak,
 * recorded or not: crew record their extra languages, not the one the shop
 * runs in (dive-domain review of layer r5-4, note 9).
 */
export function crewLanguageBriefings(input: {
  crew: readonly { name: string; languages: readonly string[] }[];
  divers: readonly { name: string; language: string }[];
  shopLanguage: string;
}): { uncovered: LanguageBriefing[]; covered: LanguageBriefing[] } {
  const byLanguage = new Map<string, string[]>();
  for (const diver of input.divers) {
    const names = byLanguage.get(diver.language) ?? [];
    if (!names.includes(diver.name)) names.push(diver.name);
    byLanguage.set(diver.language, names);
  }
  const uncovered: LanguageBriefing[] = [];
  const covered: LanguageBriefing[] = [];
  for (const [language, divers] of byLanguage) {
    if (language === input.shopLanguage) continue;
    const crew = input.crew
      .filter((member) => member.languages.includes(language))
      .map((member) => member.name);
    if (crew.length === 0) uncovered.push({ language, divers, crew });
    else covered.push({ language, divers, crew });
  }
  return { uncovered, covered };
}
