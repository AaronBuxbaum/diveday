/**
 * **Facts come from the record, never from the model** (build plan, "Claude
 * assists": copywriter, site-brief, monday, recap). A drafted sentence names a
 * fact by a placeholder (`{maxDepth}`), and this fills it from the value the
 * caller read off the row. Text that writes a digit of its own, or names a
 * placeholder the caller did not offer, is refused whole: a draft with one
 * invented depth in it is worse than no draft.
 */

const PLACEHOLDER = /\{([A-Za-z][\w.:-]*)\}/g;

/** Every placeholder the text names, in order, repeats included. */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/**
 * The text with each `{key}` replaced by `facts[key]`, or null when the text
 * names a key `facts` does not hold or carries a digit outside a placeholder.
 */
export function fillFacts(text: string, facts: Readonly<Record<string, string>>): string | null {
  let unknown = false;
  const bare = text.replace(PLACEHOLDER, (_whole, key: string) => {
    if (!Object.hasOwn(facts, key)) unknown = true;
    return "";
  });
  if (unknown || /\p{Nd}/u.test(bare)) return null;
  return text.replace(PLACEHOLDER, (_whole, key: string) => facts[key] ?? "").trim();
}

/** The runs of digits in a text, sorted, for comparing two texts' numbers. */
export function digitRuns(text: string): string[] {
  return [...text.matchAll(/\p{Nd}+(?:[.,]\p{Nd}+)?/gu)].map((match) => match[0]).sort();
}

/**
 * True when every number in `output` appears in `source`: a summary or a
 * translation may drop a number, never add or change one.
 */
export function numbersCameFrom(output: string, source: string): boolean {
  const offered = new Map<string, number>();
  for (const run of digitRuns(source)) offered.set(run, (offered.get(run) ?? 0) + 1);
  for (const run of digitRuns(output)) {
    const left = offered.get(run) ?? 0;
    if (left === 0) return false;
    offered.set(run, left - 1);
  }
  return true;
}

/** True when both texts carry the same placeholders (`{depth18}`), as multisets. */
export function samePlaceholders(a: string, b: string): boolean {
  const left = placeholdersIn(a).sort();
  const right = placeholdersIn(b).sort();
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** Trimmed, at most `max` characters, or null when nothing is left. */
export function boundedText(value: string | null | undefined, max: number): string | null {
  const text = value?.trim() ?? "";
  if (!text) return null;
  return text.length > max ? null : text;
}

/** The locale's language as the prompt names it. */
export function languageName(locale: string): string {
  return locale.toLowerCase().startsWith("es")
    ? "Latin American Spanish"
    : "English (United States)";
}

/**
 * The brand voice every drafted sentence is held to, in one place so each
 * assist's instructions say it the same way (docs/design/brand.md, "What gives
 * us away").
 */
export const VOICE_RULES = [
  "Write like a competent divemaster briefing a crew: warm, plain, brief.",
  "No em dashes, no exclamation marks, no rhetorical questions, no intensifiers such as actually, genuinely, truly, incredibly.",
  "No 'not X, Y' contrasts, no lists of three for rhythm, no closing flourish.",
  "American spelling in English.",
].join(" ");
